# Multi-Tenant Architecture and Data Isolation Guarantees

**Audience:** developers, operators, and integrators deploying Trustchain Escrow in a multi-tenant configuration.

Related reading:

- [Configuration Reference](configuration.md) — environment variables for tenant scoping
- [Security Model](security-model.md) — threat model and access control matrix
- [API Reference](api-reference.md) — tenant-aware endpoints

---

## Table of Contents

1. [Overview](#overview)
2. [Tenant Model](#tenant-model)
3. [Self-Hosted Tenant Setup Walkthrough](#self-hosted-tenant-setup-walkthrough)
4. [Tenant Resolution](#tenant-resolution)
5. [Data Isolation](#data-isolation)
6. [Cache and Queue Isolation](#cache-and-queue-isolation)
7. [Audit Chain Integrity](#audit-chain-integrity)
8. [Tenant Lifecycle](#tenant-lifecycle)
9. [Cross-References](#cross-references)

---

## Overview

Trustchain Escrow is designed as a multi-tenant platform. Each tenant represents an independent deployment context — typically a single organization or a distinct business unit — that operates its own escrows, users, disputes, and reputation records in complete isolation from other tenants.

The architecture guarantees that:

- Data belonging to one tenant is never visible to another tenant at the database, application, or cache layer.
- Every request is scoped to a single tenant, resolved automatically from the request context.
- Audit logs are append-only and tenant-partitioned, making it impossible to tamper with or mix audit trails across tenants.

---

## Tenant Model

The `Tenant` record is stored in PostgreSQL via Prisma and is the root of all tenant-scoped data.

```prisma
model Tenant {
  id            String   @id @default(cuid())
  slug          String   @unique
  name          String
  status        String   @default("active")
  domains       String[] @default([])
  branding      Json?
  configuration Json?
  metadata      Json?
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  users                User[]
  escrows              Escrow[]
  milestones           Milestone[]
  reputationRecords    ReputationRecord[]
  reputationEvents     ReputationEvent[]
  disputes             Dispute[]
  disputeEvidence      DisputeEvidence[]
  disputeAppeals       DisputeAppeal[]
  userProfiles         UserProfile[]
  auditLogs            AuditLog[]
  // ... all other tenant-scoped models
}
```

### Key Fields

| Field | Purpose |
| ----- | ------- |
| `id` | Unique internal identifier (CUID) |
| `slug` | Human-readable tenant identifier used in URL routing and cache keys |
| `name` | Display name for the tenant |
| `status` | `active` or `suspended`; inactive tenants reject all requests |
| `domains` | List of domains that resolve to this tenant (for host-based resolution) |
| `branding` | Custom branding configuration (logo, colors, etc.) |
| `configuration` | Per-tenant feature flags and runtime settings |
| `metadata` | Arbitrary JSON metadata for integration partners |

---

## Self-Hosted Tenant Setup Walkthrough

This section is for operators standing up a new tenant on a self-hosted deployment.
All steps use the admin API (`backend/api/routes/adminRoutes.js`), which is
protected by `adminAuth` — either the raw `x-admin-api-key` header or a short-lived
bearer token obtained from `POST /api/admin/auth/login`. The examples below use the
raw key for brevity.

### 1. Create the tenant

```bash
curl -X POST http://localhost:4000/api/admin/tenants \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "slug": "acme",
        "name": "Acme Corp",
        "domains": ["acme.trustchain.example"]
      }'
```

Only `slug` and `name` are required — `status` defaults to `"active"`, and
`domains`, `branding`, `configuration`, and `metadata` default to empty. `slug` is
normalized server-side (lowercased, non-alphanumeric characters collapsed to `-`)
before the uniqueness check, so pass a human-readable value and let the API derive
the canonical form.

Response `201 Created`:

```json
{
  "tenant": {
    "id": "clz9k1m4k0011qzrmvb2h7t3f",
    "slug": "acme",
    "name": "Acme Corp",
    "status": "active",
    "domains": ["acme.trustchain.example"],
    "branding": {},
    "configuration": {},
    "metadata": {},
    "createdAt": "2026-07-25T10:12:04.221Z",
    "updatedAt": "2026-07-25T10:12:04.221Z"
  }
}
```

A `slug` that already exists returns `409 { "error": "Tenant already exists" }`.

### 2. Set the tenant's custom domain

`domains` is set at creation or updated later with `PATCH /api/admin/tenants/:tenantId`:

```bash
curl -X PATCH http://localhost:4000/api/admin/tenants/clz9k1m4k0011qzrmvb2h7t3f \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["acme.trustchain.example", "escrow.acme.com"]}'
```

Adding a domain here only affects **tenant resolution** (step 4 of
[Tenant Resolution](#tenant-resolution) — matching `Host` / `X-Forwarded-Host`
against `domains`). It does **not** configure CORS: the API's allowed browser
origins are a single, deployment-wide list read from the `ALLOWED_ORIGINS`
environment variable (`backend/server.js`), shared by every tenant on the
instance. If a tenant's dashboard is served from a custom domain and calls the
API directly from the browser, that origin must also be added to
`ALLOWED_ORIGINS` and the backend restarted — updating `domains` alone will
resolve the tenant correctly but the browser request will still fail CORS.

### 3. Send the `X-Tenant-ID` header on API requests

Once a tenant exists, scope any request to it explicitly rather than relying on
host-based resolution — this is the highest-precedence resolution rule and is the
most reliable option for server-to-server integrations that don't go through the
tenant's custom domain:

```bash
curl http://localhost:4000/api/escrows \
  -H "Authorization: Bearer $JWT" \
  -H "X-Tenant-ID: clz9k1m4k0011qzrmvb2h7t3f"
```

`X-Tenant-Slug: acme` works the same way and is often easier to hardcode in
integration config than the CUID. Every response also echoes `X-Tenant-Slug` so
you can confirm which tenant a request was actually resolved against. Requests
with no matching header or domain fall back to `DEFAULT_TENANT_SLUG` (see
[Tenant Resolution](#tenant-resolution)), so a missing or misspelled header fails
silently into the default tenant rather than erroring — always verify the
response's `X-Tenant-Slug` when debugging.

### 4. Isolation guarantees for a new tenant

What is **isolated** per tenant, enforced by the mechanisms in
[Data Isolation](#data-isolation) and [Cache and Queue Isolation](#cache-and-queue-isolation):

- Database rows — every tenant-scoped Prisma model carries `tenantId` and every
  query is filtered by it.
- Redis cache keys and rate-limit counters — prefixed with the tenant slug via
  `scopeCacheKey`.
- Webhook subscriptions and deliveries, escrows, milestones, disputes, reputation
  records, and audit log chains — each tenant has its own, and its own audit hash
  chain (see [Audit Chain Integrity](#audit-chain-integrity)).

What is **shared** across all tenants on a single self-hosted instance:

- The Postgres database and Redis instance themselves — isolation is enforced in
  application code (query filters and key prefixes), not by separate database
  instances or Redis namespaces per tenant.
- The `ADMIN_API_KEY` / `ADMIN_JWT_SECRET` credentials — admin API access is
  instance-wide, not per-tenant; anyone with the admin key can read or modify
  every tenant on the deployment, including creating and suspending tenants.
- CORS configuration (`ALLOWED_ORIGINS`) and other process-level environment
  variables — these apply to the whole backend process, not to one tenant.
- Application and contract code, and the underlying Soroban contract deployment
  the indexer polls (`ESCROW_CONTRACT_ID`) — all tenants on one instance share
  the same indexer and the same on-chain contract unless you deploy a second
  instance with its own contract.

If tenants require hard isolation at the database or process level rather than
row-level scoping, deploy separate instances instead of separate tenants on one
instance.

---

## Tenant Resolution

Every incoming request is associated with exactly one tenant. The tenant is resolved in the following order of precedence:

1. **`X-Tenant-ID` header** — exact match on the tenant's internal `id`.
2. **`X-Tenant-Slug` header** — exact match on the tenant's `slug`.
3. **`Host` / `X-Forwarded-Host` header** — the request hostname is checked against the tenant's `domains` list.
4. **Default tenant** — if no match is found, the request falls back to the tenant whose slug matches `DEFAULT_TENANT_SLUG` (defaults to `"default"`).

This resolution is implemented in `backend/api/middleware/tenant.js`:

```javascript
function extractHostname(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host;

  if (!rawHost) return null;
  return rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
}
```

The resolved tenant object is attached to `req.tenant` and `res.locals.tenant`, and the response header `X-Tenant-Slug` is set so downstream services can correlate logs.

### Tenant Context Propagation

The tenant context is propagated through the async call chain using Node.js `AsyncLocalStorage`:

```javascript
export function runWithTenantContext(tenant, callback) {
  return tenantStorage.run({ tenant, bypassTenantScope: false }, callback);
}

export function getTenantContext() {
  return tenantStorage.getStore() ?? null;
}
```

This ensures that every database query, cache key, and audit log entry within a request is automatically tagged with the correct tenant.

---

## Data Isolation

### Database-Level Isolation

Every table in the Prisma schema includes a `tenantId` column (mapped to `tenant_id` in the database). All queries performed through the backend are scoped to the current tenant via Prisma `where` clauses:

```
WHERE tenant_id = '<current-tenant-id>'
```

This means that even if an attacker bypasses the application layer and queries the database directly, they can only see rows belonging to their tenant.

### Index Strategy

Every tenant-scoped table has composite indexes that include `tenantId` as the leading column. This ensures that:

- Queries filtering by tenant are efficient even on large tables.
- PostgreSQL can use index-only scans for tenant-scoped queries without touching the heap.

Example indexes:

```
@@index([tenantId, createdAt(sort: Desc)])
@@index([tenantId, email])
@@index([tenantId, clientAddress])
@@index([tenantId, status])
@@index([tenantId, status, createdAt(sort: Desc)])
```

### Application-Level Isolation

The tenant middleware sets `req.tenant` before any route handler executes. All controllers and services read the tenant from `req.tenant.id` and include it in every database operation. There is no code path that can accidentally leak data across tenants.

### Cache Isolation

Cache keys are prefixed with the tenant slug to prevent cross-tenant cache pollution:

```javascript
export function scopeCacheKey(key, tenant = getCurrentTenant()) {
  if (isTenantScopeBypassed()) return key;
  if (!tenant) return key;
  return `tenant:${tenant.slug || tenant.id}:${key}`;
}
```

This means that a cache entry for `tenant:acme:escrow:123` is completely separate from `tenant:othercorp:escrow:123`.

---

## Cache and Queue Isolation

### Redis

All Redis keys used by the backend are tenant-scoped via the `scopeCacheKey` and `scopeCacheTag` functions. This applies to:

- Escrow query caches
- Rate-limit counters
- Job queue metadata
- Session tokens

### BullMQ Queues

Webhook delivery jobs and background workers are scoped to the tenant context. The `runWithTenantContext` wrapper ensures that when a worker processes a job, it operates within the correct tenant scope.

---

## Audit Chain Integrity

Each tenant has an independent audit chain. The `AuditVerifier` service constructs a hash chain of all audit log entries for a tenant:

```
entry_hash[0] = SHA-256(GENESIS || id || tenantId || category || action || actor || createdAt)
entry_hash[n] = SHA-256(entry_hash[n-1] || id || tenantId || category || action || actor || createdAt)
```

The final entry hash is the "root hash" for that tenant's log chain. This makes it possible to verify that no audit entries have been inserted, removed, or modified for a given tenant.

If an audit chain violation is detected, the `lockAdminFeatures` function sets a Redis flag that prevents sensitive admin operations for that tenant until the issue is resolved.

---

## Tenant Lifecycle

### Creating a Tenant

A new tenant is created by an administrator via the admin API or Prisma directly. The minimum required fields are `slug`, `name`, and `status`.

### Suspending a Tenant

Setting `status` to `suspended` causes the tenant middleware to reject all requests with a `403 Forbidden` response. Existing data is preserved and can be restored by setting `status` back to `active`.

### Data Deletion

To fully delete a tenant and all its data, use Prisma's cascading delete or run a tenant-scoped data purge script. Because every table includes `tenantId`, a single `deleteMany` with `where: { tenantId }` removes all associated records.

---

## Cross-References

- [Configuration Reference](configuration.md) — `DEFAULT_TENANT_SLUG` and `DEFAULT_TENANT_ID` env vars
- [Security Model](security-model.md) — tenant isolation in the threat model
- [API Reference](api-reference.md) — tenant-aware endpoint patterns
- [Audit Log Guide](audit-log.md) — audit chain details