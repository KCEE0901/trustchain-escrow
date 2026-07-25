# Configuration Reference

Every environment variable and configuration option Trustchain Escrow reads,
grouped by the subsystem that consumes it.

**Audience:** developers running the stack locally and operators deploying it.

Related reading:

- [CONTRIBUTING.md](../CONTRIBUTING.md) — local setup walkthrough
- [backend/docs/webhook-delivery.md](../backend/docs/webhook-delivery.md) — webhook delivery tuning
- [docs/indexer-guide.md](indexer-guide.md) — indexer operation
- [docs/monitoring/setup.md](monitoring/setup.md) — metrics, tracing, and alerting
- [docs/disaster-recovery.md](disaster-recovery.md) — backup and restore procedures
- [docs/SECURITY.md](SECURITY.md) — vulnerability disclosure

---

## Table of contents

- [How configuration is loaded](#how-configuration-is-loaded)
- [Minimum viable configuration](#minimum-viable-configuration)
- [Startup validation](#startup-validation)
- [Secrets management](#secrets-management)
- [Backend reference](#backend-reference)
  - [Core runtime](#core-runtime)
  - [Database](#database)
  - [Stellar and Soroban](#stellar-and-soroban)
  - [Authentication and secrets](#authentication-and-secrets)
  - [Multi-tenancy](#multi-tenancy)
  - [Redis, queues, and workers](#redis-queues-and-workers)
  - [Event indexer](#event-indexer)
  - [Webhooks](#webhooks)
  - [WebSockets](#websockets)
  - [Rate limiting](#rate-limiting)
  - [Response caching](#response-caching)
  - [Search (Elasticsearch)](#search-elasticsearch)
  - [Email](#email)
  - [IPFS and file uploads](#ipfs-and-file-uploads)
  - [KYC, AML, and compliance](#kyc-aml-and-compliance)
  - [Payments](#payments)
  - [Fraud scoring](#fraud-scoring)
  - [Audit log](#audit-log)
  - [Logging](#logging)
  - [Monitoring, tracing, and alerting](#monitoring-tracing-and-alerting)
  - [Incident response](#incident-response)
  - [Batch API](#batch-api)
  - [PDF and media generation](#pdf-and-media-generation)
  - [Chaos testing](#chaos-testing)
- [Frontend reference](#frontend-reference)
- [Mobile reference](#mobile-reference)
- [Docker Compose](#docker-compose)
- [Operational scripts](#operational-scripts)
- [Environment profiles](#environment-profiles)
- [Known configuration gaps](#known-configuration-gaps)
- [Troubleshooting](#troubleshooting)

---

## How configuration is loaded

Each workspace has its own environment file. There is **no** root-level `.env` —
configuration is per-workspace, and the backend never reads the frontend's file or
vice versa.

| Workspace  | File               | Template                | Loaded by                             |
| ---------- | ------------------ | ----------------------- | ------------------------------------- |
| Backend    | `backend/.env`     | `backend/.env.example`  | `dotenv` at process start             |
| Frontend   | `frontend/.env.local` | `frontend/.env.example` | Next.js build and runtime          |
| Mobile     | `mobile/.env`      | `mobile/.env.example`   | Expo at bundle time                   |

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp mobile/.env.example mobile/.env
```

### Precedence

```mermaid
flowchart TD
    A[Process environment<br/>exported vars, CI secrets,<br/>container env] --> D[Effective config]
    B[.env file<br/>loaded by dotenv] --> D
    C[Hardcoded default<br/>in the reading module] --> D
    A -.->|wins over| B
    B -.->|wins over| C
```

Real process-environment variables always win over `.env` file entries, which win
over the in-code default. In production, inject secrets through the platform's
environment rather than shipping a `.env` file.

When `SECRETS_BACKEND=vault`, `lib/secrets.js` fetches values from HashiCorp Vault
and merges them **into** `process.env` at startup, so downstream modules read them
the same way regardless of backend.

### Conventions

| Convention                          | Meaning                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `*_MS`, `*_SEC`, `*_SECONDS`         | Durations in the named unit. Parsed with `parseInt`.                                    |
| `*_URL`                              | Full URL including scheme.                                                              |
| `*_ENABLED`                          | Boolean, compared against the literal string `'true'`. Any other value is false.        |
| `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`    | **Inlined into the client bundle at build time.** Never put a secret behind this prefix. |
| Comma-separated lists                | `ALLOWED_ORIGINS`, `IPFS_GATEWAYS`, `RPC_MONITOR_ENDPOINTS`, and similar. No spaces.     |
| Expiry strings (`15m`, `7d`, `24h`)  | `jsonwebtoken` duration syntax, not milliseconds.                                        |

> **Boolean gotcha:** most flags require the exact string `'true'`, so `1`, `yes`,
> and `TRUE` all read as false. The exceptions are `TRACING_ENABLED`, which is on
> unless set to the exact string `'false'`, and `LOG_FILE_ENABLED` /
> `WS_ESCROW_SUBSCRIBE_REQUIRE_PARTY`, which lowercase the value first.

---

## Minimum viable configuration

The smallest backend `.env` that boots and serves requests against a local
Postgres:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/stellar_escrow
DIRECT_URL=postgresql://user:password@localhost:5432/stellar_escrow

# Auth — all five must be present, distinct, and ≥32 chars
# Generate each separately:  openssl rand -hex 32
JWT_SECRET=<32+ random hex>
JWT_ACCESS_SECRET=<32+ random hex, different>
JWT_REFRESH_SECRET=<32+ random hex, different>
MFA_JWT_SECRET=<32+ random hex, different>
ADMIN_JWT_SECRET=<32+ random hex, different>
ADMIN_API_KEY=<32+ random hex>

# Runtime
PORT=4000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000

# Required by the prestart validator only — see "Startup validation".
# Nothing reads these at runtime, but `npm start` refuses to boot without them.
MFA_SECRET=<32+ random hex>
CONTRACT_ID=<deployed contract id>
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

`npm run dev -w backend` (nodemon) skips the `prestart` hook, so the last block is
only needed for `npm start`.

Everything else has a working default or degrades gracefully. Notable degradations
when a subsystem is left unconfigured:

| Unset                     | Consequence                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| `REDIS_URL`               | Caching and rate limiting fall back to in-memory; **queues and webhooks do not run**. |
| `ESCROW_CONTRACT_ID`      | Indexer logs `indexer_escrow_contract_id_unset` and indexes nothing.           |
| `ELASTICSEARCH_URL`       | Search falls back to Postgres queries.                                          |
| `SENTRY_DSN`              | Error reporting is disabled; the app runs normally.                             |
| `STRIPE_SECRET_KEY`       | Fiat payment endpoints fail; escrow flows are unaffected.                        |
| `SUMSUB_APP_TOKEN`        | KYC endpoints fail; escrow flows are unaffected.                                 |

---

## Startup validation

Two layers check configuration, and both fail loudly rather than running with a
weak key.

**1. At import time —** [`backend/config/secrets.js`](../backend/config/secrets.js)
loads the five JWT secrets and throws immediately if one is missing, so the process
never starts with a forgeable key. Under `NODE_ENV=test` it synthesises random
per-run values instead; under `SECRETS_BACKEND=vault` it tolerates a missing value
because Vault populates `process.env` asynchronously.

**2. Before start and before deploy —** two separate validator scripts exist, and
they check **different** variables. Both exit non-zero on failure.

[`scripts/check-env.js`](../scripts/check-env.js) is the one actually wired up: it
runs as `prestart` for `npm start -w backend` and again in
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It gates the
server from booting.

| Requires                                                                     | Rule                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`, `SOROBAN_RPC_URL`, `CONTRACT_ID`                | present, ≥ 8–10 chars                       |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_SECRET`                             | present, ≥ 32 chars                         |
| `STELLAR_NETWORK`                                                            | exactly `testnet` or `mainnet`              |
| All of the above                                                             | must not contain `change_this_in_production`, `fallback_access_secret`, `secret`, `password`, or `your_secret_here` |
| `JWT_SECRET` ≠ `JWT_REFRESH_SECRET`                                          | **warning only**, not an error              |

> **Two traps here.** This validator demands `MFA_SECRET` and `CONTRACT_ID`, but
> **no application code reads either name** — the runtime uses `MFA_JWT_SECRET` and
> `ESCROW_CONTRACT_ID`. You must set the validator's names to start the server, and
> the runtime's names for the features to work. Its "insecure default" check is also
> a substring match, so any secret containing the word `secret` or `password` is
> rejected — generate with `openssl rand -hex 32` and the problem does not arise.

[`backend/scripts/check-env.js`](../backend/scripts/check-env.js) is the stricter
secret-hygiene check. Nothing invokes it automatically; run it by hand before a
production deploy:

```bash
node backend/scripts/check-env.js
```

| Check                   | Applies to                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Present                 | `JWT_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MFA_JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_API_KEY`  |
| At least 32 characters  | All of the above                                                                                                |
| Not a known placeholder | All of the above — the `change_this_*` and `fallback_*` values shipped in `.env.example` are rejected            |
| Mutually distinct       | The five JWT secrets. Sharing one lets a token minted for one purpose be replayed for another.                  |

Read the secrets through `config/secrets.js` rather than `process.env.JWT_SECRET`
directly; the module exists specifically to remove the "default to a known string"
footgun.

---

## Secrets management

`SECRETS_BACKEND` selects where secret material comes from.

| Value             | Behaviour                                                        |
| ----------------- | ---------------------------------------------------------------- |
| `env` *(default)* | Read straight from `process.env`. Fine for development and CI.    |
| `vault`           | Fetch from HashiCorp Vault at startup and merge into `process.env`. |

| Variable                       | Default                    | Description                                                     |
| ------------------------------ | -------------------------- | --------------------------------------------------------------- |
| `SECRETS_BACKEND`              | `env`                      | `env` or `vault`. Case-insensitive.                              |
| `VAULT_ADDR`                   | `http://127.0.0.1:8200`    | Vault server address.                                            |
| `VAULT_ROLE_ID`                | —                          | AppRole role id. Preferred for production.                       |
| `VAULT_SECRET_ID`              | —                          | AppRole secret id.                                               |
| `VAULT_TOKEN`                  | `''`                       | Static token. Development and CI only — use AppRole in production. |
| `VAULT_KV_PATH`                | `stellar-trust/app`        | KV v2 path holding the application secrets.                      |
| `VAULT_NAMESPACE`              | `''`                       | Vault Enterprise namespace. Leave blank on OSS.                  |
| `SECRETS_CACHE_TTL_MS`         | `300000` (5 min)           | How long fetched secrets are cached in-process.                  |
| `SECRETS_ROTATION_INTERVAL_MS` | `3600000` (1 h)            | How often secrets are re-fetched.                                |

---

## Backend reference

Defaults below are the values the code falls back to when the variable is unset.
A dash means there is no default — the feature is off, or the call fails, until you
set it.

### Core runtime

| Variable          | Default       | Description                                                                    |
| ----------------- | ------------- | ------------------------------------------------------------------------------ |
| `NODE_ENV`        | `development` | `development`, `production`, or `test`. Test mode relaxes CSRF, skips the gateway rate limiter, and does not start the queue workers. |
| `PORT`            | `4000`        | HTTP listen port.                                                               |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS allowlist. Credentials are enabled, so wildcards are unsafe. |
| `FRONTEND_URL`    | —             | Public frontend base URL, used to build links in redirects and payment flows.    |
| `API_DOCS_URL`    | `/docs`       | Path the Swagger UI is served from.                                             |
| `COMPRESSION_LEVEL`     | `6`     | gzip level, 0–9.                                                                |
| `COMPRESSION_THRESHOLD` | `1024`  | Minimum response size in bytes before compression applies.                       |
| `BROTLI_QUALITY`        | `4`     | Brotli quality, 0–11.                                                           |

### Database

| Variable               | Default                | Description                                                                  |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`         | — **(required)**       | Postgres connection string, pooled. Supports `?connection_limit=`, `?pool_timeout=`. |
| `DIRECT_URL`           | —                      | Non-pooled connection used by `prisma migrate`. Locally, set it equal to `DATABASE_URL`. |
| `READ_REPLICA_URLS`    | `''`                   | Comma-separated read-replica connection strings. Reads are load-balanced across them. |
| `ANALYTICS_DB_URL`     | —                      | Separate connection for analytics writes. Falls back to the primary if unset.  |
| `QUERY_TIMEOUT_MS`     | `30000` (`250` in test)| Per-query statement timeout.                                                  |
| `SLOW_QUERY_THRESHOLD_MS` | `200` / `500`       | Queries slower than this are logged. Two thresholds exist: the Prisma middleware uses `200`, the performance monitor `500`. |
| `TX_MAX_RETRIES`       | `3`                    | Retries for a transaction that fails on serialisation conflict.                |
| `TX_BASE_DELAY_MS`     | `50`                   | Base backoff between transaction retries.                                      |
| `TX_ISOLATION_LEVEL`   | `ReadCommitted`        | Prisma isolation level, e.g. `Serializable`.                                   |
| `DB_RETRY_MAX`         | `3`                    | Connection retry attempts.                                                     |
| `DB_RETRY_BASE_MS`     | `50`                   | Base connection retry backoff.                                                 |
| `DB_RETRY_MAX_MS`      | `200`                  | Cap on connection retry backoff.                                               |
| `GC_SAFETY_BUFFER_HOURS` | `24`                 | Grace period before expired rows are eligible for cleanup.                     |

### Stellar and Soroban

| Variable                | Default                                    | Description                                            |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `STELLAR_NETWORK`       | `testnet`                                  | `testnet`, `mainnet`, or `standalone`.                 |
| `SOROBAN_RPC_URL`       | `https://soroban-testnet.stellar.org`      | Soroban RPC endpoint.                                  |
| `STELLAR_HORIZON_URL`   | `https://horizon-testnet.stellar.org`      | Horizon endpoint.                                      |
| `HORIZON_ENDPOINTS`     | falls back to the single default endpoint  | Comma-separated Horizon endpoints for failover.        |
| `ESCROW_CONTRACT_ID`    | `''`                                       | Deployed escrow contract. **Required for indexing, webhooks, and the relayer.** |
| `RELAYER_SECRET_KEY`    | —                                          | Stellar secret key funding gasless meta-transactions. Treat as a hot wallet. |
| `USDC_ISSUER`           | —                                          | USDC issuer address. Mainnet: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`. |
| `PLATFORM_FEE_PERCENT`  | `1.5`                                      | Platform fee as a percentage.                          |
| `GAS_ESTIMATOR_API_KEYS`| `''`                                       | Comma-separated API keys for the gas estimation endpoint. |

### Authentication and secrets

All five JWT secrets are **required, mutually distinct, and at least 32 characters**
— see [Startup validation](#startup-validation).

| Variable                   | Default   | Description                                                     |
| -------------------------- | --------- | --------------------------------------------------------------- |
| `JWT_SECRET`               | — **(required)** | Signs wallet session tokens.                              |
| `JWT_ACCESS_SECRET`        | — **(required)** | Signs short-lived access tokens (including WebSocket upgrade). |
| `JWT_REFRESH_SECRET`       | — **(required)** | Signs refresh tokens.                                     |
| `MFA_JWT_SECRET`           | — **(required)** | Signs multi-factor step-up tokens (`x-mfa-token`).        |
| `ADMIN_JWT_SECRET`         | — **(required)** | Signs admin session tokens from `POST /api/admin/auth/login`. |
| `ADMIN_API_KEY`            | — **(required)** | Exchanged for an admin session token.                     |
| `JWT_EXPIRES_IN`           | `24h`     | Wallet session token lifetime.                                   |
| `JWT_ACCESS_EXPIRATION`    | `15m`     | Access token lifetime.                                           |
| `ADMIN_TOKEN_TTL`          | `15m`     | Admin session token lifetime.                                    |
| `MFA_ENCRYPTION_KEY`       | random per boot | Encrypts stored TOTP secrets. **Set this in production** — the random default makes every enrolled TOTP secret undecryptable after a restart. |
| `MFA_HIGH_VALUE_THRESHOLD` | `10000`   | Escrow amount above which step-up MFA is demanded.               |
| `WEBAUTHN_RP_ID`           | `localhost` | WebAuthn relying-party id — your registrable domain.           |
| `WEBAUTHN_RP_NAME`         | `StellarTrustEscrow` | Name shown in the authenticator prompt.               |
| `WEBAUTHN_ORIGIN`          | `http://localhost:3000` | Expected origin for WebAuthn assertions.            |

### Multi-tenancy

| Variable              | Default          | Description                                    |
| --------------------- | ---------------- | ---------------------------------------------- |
| `DEFAULT_TENANT_ID`   | `tenant_default` | Tenant assigned to requests with no tenant context. |
| `DEFAULT_TENANT_SLUG` | `default`        | Slug for the default tenant.                   |
| `DEFAULT_TENANT_NAME` | `Default Tenant` | Display name for the default tenant.           |

### Redis, queues, and workers

Redis backs BullMQ, the sliding-window rate limiters, and the response cache. The
cache and rate limiters degrade to in-memory when Redis is absent; **the queues do
not** — without Redis, webhooks and email are never delivered.

| Variable            | Default                  | Description                                                   |
| ------------------- | ------------------------ | ------------------------------------------------------------- |
| `REDIS_URL`         | `redis://localhost:6379` | Full connection URL. Takes precedence over the host/port pair. |
| `REDIS_HOST`        | `localhost` / `127.0.0.1`| Host, when not using `REDIS_URL`.                             |
| `REDIS_PORT`        | `6379`                   | Port, when not using `REDIS_URL`.                             |
| `REDIS_PASSWORD`    | —                        | AUTH password.                                                |
| `QUEUE_CONCURRENCY` | `5`                      | Concurrent jobs per worker.                                   |

### Event indexer

See [docs/indexer-guide.md](indexer-guide.md) for operational detail.

| Variable                      | Default | Description                                                             |
| ----------------------------- | ------- | ----------------------------------------------------------------------- |
| `INDEXER_POLL_INTERVAL_MS`    | `5000`  | Polling cadence. Also the floor on webhook delivery latency.             |
| `INDEXER_START_LEDGER`        | `0`     | Ledger to begin indexing from. `0` means resume from the stored cursor.  |
| `INDEXER_BATCH_SIZE`          | `100`   | Events fetched per poll.                                                |
| `INDEXER_BASE_BACKOFF_MS`     | `1000`  | Base backoff after an RPC failure.                                      |
| `INDEXER_MAX_BACKOFF_MS`      | `60000` | Cap on RPC failure backoff.                                             |
| `INDEXER_LOCK_TTL_MS`         | `30000` | Redlock TTL. Locks auto-expire if a node crashes mid-batch.             |
| `INDEXER_LOCK_RETRY_COUNT`    | `3`     | Lock acquisition attempts before skipping the batch.                     |
| `INDEXER_LOCK_RETRY_DELAY_MS` | `200`   | Delay between lock attempts.                                            |
| `NODE_RECOVERY_WINDOW_MS`     | `300000`| Window during which a restarted node is treated as recovering.           |

### Webhooks

Full behaviour is documented in the
[webhook delivery guide](../backend/docs/webhook-delivery.md).

| Variable                     | Default | Description                                                    |
| ---------------------------- | ------- | -------------------------------------------------------------- |
| `WEBHOOK_MAX_RETRY_ATTEMPTS` | `5`     | Attempts before a delivery is marked `failed`.                 |
| `WEBHOOK_BACKOFF_BASE_MS`    | `5000`  | Base delay for exponential backoff.                            |
| `WEBHOOK_KEEP_FAILED_JOBS`   | `100`   | Failed jobs retained in Redis for inspection. Higher aids debugging, costs memory. |

### WebSockets

| Variable                             | Default | Description                                                       |
| ------------------------------------ | ------- | ----------------------------------------------------------------- |
| `WS_HEARTBEAT_INTERVAL_MS`           | `30000` | Ping interval for liveness detection.                             |
| `WS_MAX_CONNECTIONS`                 | `100`   | Concurrent connection cap.                                        |
| `WS_ESCROW_SUBSCRIBE_REQUIRE_PARTY`  | `false` | When `true`, only escrow participants may subscribe to that escrow's stream. Recommended in production. |

### Rate limiting

| Variable                                          | Default | Description                                                    |
| ------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `RATE_LIMIT_MAX_REQUESTS_PER_MINUTE`              | `60`    | Default authenticated per-user limit.                          |
| `PUBLIC_RATE_LIMIT_WINDOW_MS`                     | `60000` | Window for the public/unauthenticated limiter.                 |
| `PUBLIC_RATE_LIMIT_IP_MAX`                        | `100`   | Max requests per IP per window.                                |
| `PUBLIC_RATE_LIMIT_WALLET_MAX`                    | `50`    | Max requests per wallet address per window.                    |
| `RATE_LIMIT_WHITELIST_IPS`                        | `''`    | Comma-separated IPs that bypass limits. Localhost is always exempt. |
| `LEADERBOARD_RATE_LIMIT_MAX_REQUESTS_PER_MINUTE`  | `30`    | Tighter dedicated limit on the leaderboard endpoint.           |
| `REPUTATION_SEARCH_RATE_LIMIT_MAX`                | `120`   | Limit on reputation search.                                    |

Webhook subscription creation carries its own hardcoded limit — 10 per 10-minute
window, not configurable by environment.

### Response caching

All values are TTLs in **seconds**.

| Variable                | Default | Applies to                          |
| ----------------------- | ------- | ----------------------------------- |
| `CACHE_TTL_DEFAULT`     | `60`    | Any cached route without a specific TTL. |
| `CACHE_TTL_LIST`        | `15`    | List endpoints.                     |
| `CACHE_TTL_DETAIL`      | `30`    | Single-resource endpoints.          |
| `CACHE_TTL_EVENTS`      | `15`    | Event timelines.                    |
| `CACHE_TTL_LEADERBOARD` | `300`   | Reputation leaderboard.             |
| `CACHE_TTL_REPUTATION`  | `60`    | Reputation lookups.                 |
| `CACHE_TTL_STATIC`      | `600`   | Rarely-changing static payloads.    |

### Search (Elasticsearch)

| Variable                | Default                  | Description                                              |
| ----------------------- | ------------------------ | -------------------------------------------------------- |
| `ELASTICSEARCH_URL`     | `http://localhost:9200`  | Cluster URL. Unset or unreachable falls back to Postgres. |
| `ELASTICSEARCH_API_KEY` | —                        | API key for Elastic Cloud or a secured cluster.           |

See [docs/elasticsearch-reputation-index.md](elasticsearch-reputation-index.md).

### Email

| Variable                   | Default                                    | Description                                             |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `EMAIL_PROVIDER`           | `console` (sender) / `bullmq` (transport)  | `console` logs instead of sending — the default for development. |
| `EMAIL_FROM`               | `no-reply@stellartrustescrow.local`        | Envelope from-address.                                   |
| `EMAIL_FROM_NAME`          | `Stellar Trust Escrow`                     | Display name.                                            |
| `EMAIL_BASE_URL`           | `http://localhost:4000`                    | Base URL for links embedded in emails.                   |
| `EMAIL_UNSUBSCRIBE_SECRET` | `stellar-trust-escrow-email-secret`        | Signs unsubscribe tokens. **Change in production** — the default lets anyone forge an unsubscribe link. |
| `SENDGRID_API_KEY`         | `''`                                       | Required when sending through SendGrid.                  |

### IPFS and file uploads

| Variable                  | Default                          | Description                                                |
| ------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `IPFS_API_URL`            | `http://127.0.0.1:5001/api/v0`   | IPFS node API.                                             |
| `IPFS_GATEWAY_URL`        | `https://ipfs.io`                | Primary read gateway.                                      |
| `IPFS_GATEWAYS`           | `''`                             | Comma-separated fallback gateways.                         |
| `IPFS_CACHE_TTL_SEC`      | `3600`                           | Cache lifetime for fetched content.                        |
| `IPFS_FETCH_TIMEOUT_MS`   | `15000`                          | Timeout for a gateway fetch.                               |
| `IPFS_REQUEST_TIMEOUT`    | `8000`                           | Timeout for an API request.                                |
| `IPFS_HEALTH_INTERVAL`    | `60000`                          | Gateway health probe cadence.                              |
| `IPFS_RECOVERY_WINDOW`    | `120000`                         | How long an unhealthy gateway stays benched.               |
| `IPFS_SYNC_MAX_RETRIES`   | `3`                              | Pin retry attempts.                                        |
| `IPFS_SYNC_RETRY_DELAY_MS`| `2000`                           | Delay between pin retries.                                 |
| `PINATA_JWT`              | —                                | Pinata JWT. Required for encrypted uploads.                |
| `PINATA_API_KEY`          | —                                | Legacy Pinata key pair.                                    |
| `PINATA_SECRET_API_KEY`   | —                                | Legacy Pinata key pair.                                    |
| `PINATA_GATEWAY_URL`      | —                                | Dedicated Pinata gateway.                                  |
| `MAX_FILE_SIZE`           | `10485760` (10 MB)               | Per-file upload cap in bytes.                              |
| `MAX_FILES`               | `5`                              | Files per upload request.                                  |
| `ALLOWED_MIME_TYPES`      | image/pdf/text/mp4 set           | Comma-separated MIME allowlist for evidence uploads.       |
| `CLAMAV_HOST`             | `localhost`                      | ClamAV daemon host for virus scanning.                     |
| `CLAMAV_PORT`             | `3310`                           | ClamAV daemon port.                                        |
| `SCAN_TIMEOUT_MS`         | `30000`                          | Virus scan timeout.                                        |
| `MAX_SCAN_FILE_SIZE`      | `10485760` (10 MB)               | Files larger than this skip scanning.                      |

### KYC, AML, and compliance

| Variable                                   | Default                  | Description                                          |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------- |
| `SUMSUB_APP_TOKEN`                         | —                        | Sumsub app token. Required for KYC.                  |
| `SUMSUB_SECRET_KEY`                        | —                        | Signs Sumsub API requests and verifies its webhooks. |
| `SUMSUB_BASE_URL`                          | `https://api.sumsub.com` | Sumsub API base.                                     |
| `SUMSUB_LEVEL_NAME`                        | `basic-kyc-level`        | Verification level applicants are assigned.          |
| `AML_PROVIDER`                             | `mock`                   | `mock` returns synthetic results — never use in production. |
| `AML_API_URL`                              | —                        | AML screening provider endpoint.                     |
| `AML_API_KEY`                              | `''`                     | AML provider credential.                             |
| `AML_RISK_THRESHOLD`                       | `70`                     | Risk score at or above which a subject is flagged.   |
| `AML_CACHE_TTL_SECONDS`                    | `3600`                   | Screening result cache lifetime.                     |
| `COMPLIANCE_REPORT_SCHEDULER`              | enabled                  | Set to `disabled` to stop scheduled compliance reports. |
| `COMPLIANCE_REPORT_SCHEDULER_INTERVAL_MS`  | `60000`                  | Scheduler tick interval.                             |

### Payments

| Variable                | Default | Description                                                    |
| ----------------------- | ------- | -------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | —       | Stripe secret key.                                             |
| `STRIPE_WEBHOOK_SECRET` | —       | Verifies inbound Stripe webhook signatures. Distinct from Trustchain's own outbound webhook secrets. |

### Fraud scoring

A weighted heuristic — a transaction is flagged once its summed weights reach
`FRAUD_SCORE_THRESHOLD`.

| Variable                | Default | Description                                             |
| ----------------------- | ------- | ------------------------------------------------------- |
| `FRAUD_SCORE_THRESHOLD` | `50`    | Score at which a transaction is flagged.                |
| `FRAUD_W_SAME_IP`       | `40`    | Weight — both parties share an IP.                      |
| `FRAUD_W_PAIR`          | `25`    | Weight — repeated counterparty pairing.                 |
| `FRAUD_W_RAPID`         | `20`    | Weight — escrows created in rapid succession.           |
| `FRAUD_W_ROUND`         | `10`    | Weight — suspiciously round amount.                     |
| `FRAUD_W_ZERO_MS`       | `5`     | Weight — zero elapsed time between steps.               |
| `FRAUD_RAPID_MS`        | `3600000` (1 h) | Window defining "rapid" succession.             |
| `FRAUD_REPEATED_PAIR`   | `3`     | Occurrences before a pairing counts as repeated.        |

### Audit log

| Variable                  | Default           | Description                                       |
| ------------------------- | ----------------- | ------------------------------------------------- |
| `AUDIT_BATCH_SIZE`        | `500`             | Entries verified per batch.                       |
| `AUDIT_VERIFY_INTERVAL_MS`| `3600000` (1 h)   | Hash-chain verification cadence.                  |
| `AUDIT_LOCK_TTL_SEC`      | `7200` (2 h)      | Lock TTL for the verification job.                |

### Logging

| Variable                | Default                        | Description                                             |
| ----------------------- | ------------------------------ | ------------------------------------------------------- |
| `LOG_LEVEL`             | `info`                         | Pino level: `debug`, `info`, `warn`, `error`.           |
| `LOG_SERVICE_NAME`      | `stellar-trust-escrow-api`     | `service` field on every log line.                      |
| `LOG_FILE_ENABLED`      | `false`                        | Set to `true` to also write logs to disk.               |
| `LOG_DIR`               | `logs`                         | Log directory.                                          |
| `LOG_FILE_NAME`         | `api.log`                      | Log filename.                                           |
| `LOG_MAX_SIZE`          | `20m`                          | Rotate at this size.                                    |
| `LOG_MAX_FILES`         | `14d`                          | Retention for rotated files.                            |
| `LOG_ROTATION_PERIOD`   | `1d`                           | Rotation period.                                        |
| `LOG_ROTATION_MAX_SIZE` | `1G`                           | Hard size cap across rotated files.                     |
| `LOG_RETENTION_DAYS`    | `30`                           | Days before rotated logs are deleted.                   |
| `LOG_AGGREGATOR_URL`    | —                              | Ships logs to an external aggregator when set.          |
| `LOG_AGGREGATOR_TOKEN`  | —                              | Aggregator credential.                                  |

### Monitoring, tracing, and alerting

See [docs/monitoring/setup.md](monitoring/setup.md).

| Variable                       | Default                    | Description                                                    |
| ------------------------------ | -------------------------- | -------------------------------------------------------------- |
| `SENTRY_DSN`                   | —                          | Sentry DSN. Unset disables error reporting.                    |
| `SENTRY_ENVIRONMENT`           | `development`              | Environment tag.                                                |
| `SENTRY_RELEASE`               | —                          | Git SHA or semver tag for release tracking.                    |
| `SENTRY_TRACES_SAMPLE_RATE`    | `0.1` prod / `1.0` dev     | Fraction of transactions traced, 0.0–1.0.                      |
| `TRACING_ENABLED`              | `true`                     | OpenTelemetry tracing. Set to the exact string `false` to disable. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | `http://localhost:4318`    | OTLP collector endpoint.                                        |
| `OTEL_SERVICE_NAME`            | `stellar-trust-escrow`     | Service name in traces.                                         |
| `OTEL_ENVIRONMENT`             | —                          | Environment attribute on spans.                                 |
| `METRICS_TOKEN`                | —                          | Bearer token guarding `/metrics`. Unset leaves the endpoint open. |
| `MONITORING_SYSTEM_ENABLED`    | `false`                    | Set to `true` to start the background monitoring system.        |
| `HEALTH_CHECK_INTERVAL_MS`     | `60000`                    | Health probe cadence.                                           |
| `HEALTH_STELLAR_TIMEOUT_MS`    | `5000`                     | Timeout for the Stellar reachability probe.                     |
| `SLOW_REQUEST_THRESHOLD_MS`    | `500`                      | Requests slower than this are logged as slow.                   |
| `ALERT_WEBHOOK_URL`            | —                          | Generic webhook for alert delivery.                             |
| `ALERT_EMAIL_ENABLED`          | `false`                    | Set to `true` to also send alerts by email.                     |
| `ALERT_EMAIL_RECIPIENTS`       | —                          | Comma-separated alert recipients.                               |

**RPC SLA monitor** — see [docs/monitoring/sla-anomaly.md](monitoring/sla-anomaly.md):

| Variable                       | Default                | Description                                                  |
| ------------------------------ | ---------------------- | ------------------------------------------------------------ |
| `RPC_MONITOR_ENDPOINTS`        | `SOROBAN_RPC_URL`      | Comma-separated endpoints to probe.                          |
| `RPC_MONITOR_POLL_INTERVAL_MS` | `10000`                | Probe cadence.                                               |
| `RPC_LATENCY_THRESHOLD_MS`     | `1500`                 | Alert above this latency.                                    |
| `RPC_FAILURE_RATE_THRESHOLD`   | `0.02` (2 %)           | Alert above this failure fraction.                           |
| `RPC_ALERT_WINDOW`             | `50`                   | Probes in the rolling failure-rate window.                   |
| `SLACK_RPC_WEBHOOK`            | —                      | Slack incoming webhook for RPC alerts.                       |

### Incident response

See [docs/incidents/on-call-guide.md](incidents/on-call-guide.md).

| Variable                 | Default | Description                                                                  |
| ------------------------ | ------- | ---------------------------------------------------------------------------- |
| `PAGERDUTY_ROUTING_KEY`  | —       | PagerDuty Events API v2 integration key.                                     |
| `SLACK_INCIDENT_WEBHOOK` | —       | Slack incoming webhook for incident notifications.                           |
| `RUNBOOK_BASE_URL`       | —       | Base URL prefixed to runbook links in alerts.                                |
| `ONCALL_SCHEDULE`        | `[]`    | JSON array of `{ name, email, phone?, startUtc, endUtc }`. Invalid JSON disables rotation lookup. |

### Batch API

| Variable                   | Default                | Description                                        |
| -------------------------- | ---------------------- | -------------------------------------------------- |
| `MAX_BATCH_SIZE`           | `20`                   | Sub-requests per batch call.                       |
| `MAX_BATCH_ITEM_BODY_BYTES`| `65536` (64 KB)        | Per-sub-request body size cap.                     |
| `BATCH_ALLOWED_ROUTES`     | built-in allowlist     | Comma-separated routes callable through the batch endpoint. |

### PDF and media generation

| Variable            | Default                          | Description                                       |
| ------------------- | -------------------------------- | ------------------------------------------------- |
| `PDF_STORAGE`       | local                            | Set to `s3` to store generated PDFs in S3.        |
| `PDF_LOCAL_DIR`     | `/tmp/escrow-pdfs`               | Local PDF output directory.                       |
| `PDF_S3_BUCKET`     | `stellar-trust-escrow-pdfs`      | S3 bucket when `PDF_STORAGE=s3`.                  |
| `AWS_REGION`        | `us-east-1`                      | AWS region for S3 operations.                     |
| `AWS_ACCESS_KEY_ID` | —                                | AWS credential. Prefer an instance role.          |
| `AWS_SECRET_ACCESS_KEY` | —                            | AWS credential.                                    |
| `THUMBNAIL_SIZE`    | `300`                            | Thumbnail edge length in pixels.                  |
| `WEB_STANDARD_SIZE` | `1920`                           | Web-standard image width in pixels.               |
| `WEBP_QUALITY`      | `85`                             | WebP encode quality, 0–100.                       |
| `MAX_TRANSCODE_SIZE`| `52428800` (50 MB)               | Largest media file accepted for transcoding.      |

### Chaos testing

Used only by the chaos harness in [`backend/chaos/`](../backend/chaos/); see
[docs/runbooks/chaos-engineering.md](runbooks/chaos-engineering.md). Never enable
against production.

| Variable             | Default                  | Description                                |
| -------------------- | ------------------------ | ------------------------------------------ |
| `CHAOS_ENABLED`      | unset                    | Set by the harness itself while a run is active. |
| `CHAOS_EXPERIMENT`   | —                        | Experiment to run.                         |
| `CHAOS_TARGET_URL`   | `http://localhost:4000`  | Target under test.                         |
| `CHAOS_CONNECTIONS`  | `10`                     | Concurrent connections.                    |
| `CHAOS_LOAD_DURATION`| `10`                     | Load duration in seconds.                  |
| `CHAOS_REPORT_DIR`   | —                        | Where reports are written.                 |

---

## Frontend reference

Set in `frontend/.env.local`. **Anything prefixed `NEXT_PUBLIC_` is compiled into
the browser bundle** — it is public, permanently, to every visitor. Never place a
key there that you would not print on the landing page.

| Variable                            | Default                                    | Description                                        |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`               | `http://localhost:4000`                    | Backend base URL.                                  |
| `NEXT_PUBLIC_API_BASE`              | —                                          | Alternate API base used by some client modules.    |
| `NEXT_PUBLIC_WS_URL`                | —                                          | WebSocket endpoint for live escrow updates.        |
| `NEXT_PUBLIC_STELLAR_NETWORK`       | `testnet`                                  | Network the wallet connects to.                    |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`      | —                                          | Escrow contract address for client-side calls.     |
| `NEXT_PUBLIC_SOROBAN_RPC_URL`       | `https://soroban-testnet.stellar.org`      | Soroban RPC used from the browser.                 |
| `NEXT_PUBLIC_HORIZON_URL`           | —                                          | Horizon endpoint used from the browser.            |
| `NEXT_PUBLIC_USDC_ISSUER`           | —                                          | USDC issuer for asset display.                     |
| `NEXT_PUBLIC_EXCHANGE_RATE_API_URL` | `https://open.er-api.com/v6/latest/USD`    | FX rate source. Free, no key required.             |
| `NEXT_PUBLIC_FX_CACHE_TTL_MS`       | `3600000` (1 h)                            | Browser-side FX rate cache lifetime.               |
| `NEXT_PUBLIC_ANALYTICS_URL`         | —                                          | Analytics collection endpoint.                     |
| `NEXT_PUBLIC_SITE_URL`              | —                                          | Canonical site URL for metadata and share links.   |
| `NEXT_PUBLIC_SENTRY_DSN`            | —                                          | Browser Sentry DSN.                                |
| `NEXT_PUBLIC_SENTRY_ENV`            | `development`                              | Browser Sentry environment tag.                    |
| `NEXT_PUBLIC_SENTRY_RELEASE`        | —                                          | Browser Sentry release tag.                        |

Server-only (build time, never inlined into the bundle):

| Variable                       | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| `SENTRY_AUTH_TOKEN`            | Uploads source maps during build. **Secret.**                     |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Sentry project coordinates for the source-map upload.             |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Server-side Sentry tags.                                  |
| `NEXT_OUTPUT`                  | Overrides the Next.js `output` mode, e.g. `standalone`.           |
| `ANALYZE`                      | Set to `true` to emit a bundle analyzer report.                   |
| `VERCEL_GIT_COMMIT_SHA`        | Supplied by Vercel; used as the release identifier when set.      |
| `BASE_URL`, `PLAYWRIGHT_BASE_URL` | Target URL for Playwright end-to-end runs.                     |
| `PLAYWRIGHT_DISABLE_WEBSERVER` | Skips starting a dev server when the target is already running.   |
| `CI`                           | Set by the CI runner; enables CI-specific test behaviour.         |

---

## Mobile reference

Set in `mobile/.env`. As with Next.js, **`EXPO_PUBLIC_` values are embedded in the
shipped app binary** and are readable by anyone who downloads it.

| Variable                        | Default                                    | Description                              |
| ------------------------------- | ------------------------------------------ | ---------------------------------------- |
| `EXPO_PUBLIC_API_URL`           | `http://localhost:4000`                    | Backend base URL.                        |
| `EXPO_PUBLIC_STELLAR_NETWORK`   | `testnet`                                  | Network the app connects to.             |
| `EXPO_PUBLIC_CONTRACT_ADDRESS`  | —                                          | Escrow contract address.                 |
| `EXPO_PUBLIC_SOROBAN_RPC_URL`   | `https://soroban-testnet.stellar.org`      | Soroban RPC endpoint.                    |
| `EXPO_PUBLIC_SENTRY_DSN`        | —                                          | Sentry DSN for the mobile app.           |
| `EXPO_PUBLIC_OFFLINE_CACHE_TTL_MS` | —                                       | TTL for the offline SQLite cache.        |

---

## Docker Compose

`docker compose up -d` starts Postgres, Elasticsearch, and a local Stellar
quickstart node. The compose file hardcodes development credentials — they are
throwaway values for local use and must never be reused elsewhere.

| Service         | Ports         | Compose-set values                                                        |
| --------------- | ------------- | -------------------------------------------------------------------------- |
| `postgres`      | `5432`        | `POSTGRES_USER=user`, `POSTGRES_PASSWORD=password`, `POSTGRES_DB=stellar_escrow` |
| `elasticsearch` | `9200`        | Single-node, security disabled, 512 MB heap                                |
| `stellar`       | `8000`, `8001`| Horizon on 8000, Soroban RPC on 8001, standalone passphrase                |
| `backend`       | `4000`        | `DATABASE_URL`, `ELASTICSEARCH_URL`, `PORT` point at the sibling services  |
| `frontend`      | `3000`        | `NEXT_PUBLIC_API_URL` passed as a **build arg** — changing it needs a rebuild |

Matching `.env` values for the compose stack:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/stellar_escrow
DIRECT_URL=postgresql://user:password@localhost:5432/stellar_escrow
ELASTICSEARCH_URL=http://localhost:9200
SOROBAN_RPC_URL=http://localhost:8001/soroban/rpc
STELLAR_HORIZON_URL=http://localhost:8000
STELLAR_NETWORK=standalone
```

`docker-compose.override.yml` and `docker-compose.test.yml` layer development and
CI-specific settings on top.

---

## Operational scripts

Shell scripts under [`scripts/`](../scripts/) read their own variables, separate
from `backend/.env`. Export them in the shell or the cron environment that runs the
script.

**Backup and restore** — [`scripts/backup.sh`](../scripts/backup.sh),
[`scripts/restore_pitr.sh`](../scripts/restore_pitr.sh); see
[docs/disaster-recovery.md](disaster-recovery.md):

| Variable                | Default                     | Description                                             |
| ----------------------- | --------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`          | —                           | Source database for `pg_dump`.                          |
| `BACKUP_DIR`            | `/var/backups/stellar-trust`| Local dump destination.                                 |
| `BACKUP_RETENTION_DAYS` | `7`                         | Days before local dumps are deleted.                    |
| `BACKUP_S3_BUCKET`      | —                           | Offsite copy destination, e.g. `s3://bucket/backups`.   |
| `BACKUP_MAX_AGE_HOURS`  | `26`                        | Alert if no successful backup within this window. Read by the backend health check. |
| `SLACK_BACKUP_WEBHOOK`  | —                           | Slack webhook for backup success/failure notices.       |
| `WAL_ARCHIVE_DIR`       | —                           | Local WAL archive path for point-in-time recovery.      |
| `WAL_ARCHIVE_S3_BUCKET` | —                           | Offsite WAL archive destination.                        |
| `S3_SSE_ALGORITHM`      | `AES256`                    | Server-side encryption for S3 uploads.                  |
| `RECOVERY_TARGET_TIME`  | —                           | PITR target timestamp during restore.                   |

**Deployment** — [`scripts/deploy.sh`](../scripts/deploy.sh),
[`scripts/deploy-testnet.sh`](../scripts/deploy-testnet.sh):

| Variable                     | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `STELLAR_SECRET_KEY`         | Deployer account secret. **Never commit.**                          |
| `NETWORK`                    | Target network name for the Stellar CLI.                            |
| `SOROBAN_NETWORK_PASSPHRASE` | Network passphrase for the target network.                          |
| `CONTRACT_ADDRESS`           | Written back to the env files after a successful deploy.            |
| `DRY_RUN`                    | Set to skip the actual submission.                                  |

---

## Environment profiles

| Setting                             | Development             | CI / test                  | Production                                    |
| ----------------------------------- | ----------------------- | -------------------------- | --------------------------------------------- |
| `NODE_ENV`                          | `development`           | `test`                     | `production`                                  |
| JWT secrets                         | `.env` placeholders     | synthesised per run        | Vault or platform secrets, ≥32 chars, distinct |
| `SECRETS_BACKEND`                   | `env`                   | `env`                      | `vault`                                       |
| `MFA_ENCRYPTION_KEY`                | may be omitted          | fixed test value           | **must be set and stable**                    |
| `STELLAR_NETWORK`                   | `testnet` / `standalone`| `standalone`               | `mainnet`                                     |
| `REDIS_URL`                         | optional                | optional                   | **required** — queues need it                 |
| `ELASTICSEARCH_URL`                 | optional                | optional                   | recommended                                   |
| `LOG_LEVEL`                         | `debug`                 | `error`                    | `info`                                        |
| `SENTRY_TRACES_SAMPLE_RATE`         | `1.0`                   | `0`                        | `0.1`                                         |
| `METRICS_TOKEN`                     | may be omitted          | may be omitted             | **set it** — otherwise `/metrics` is public   |
| `WS_ESCROW_SUBSCRIBE_REQUIRE_PARTY` | `false`                 | `false`                    | `true`                                        |
| `ALLOWED_ORIGINS`                   | `http://localhost:3000` | `http://localhost:3000`    | exact production origins only                 |
| `AML_PROVIDER`                      | `mock`                  | `mock`                     | a real provider                               |
| `EMAIL_PROVIDER`                    | `console`               | `console`                  | a real provider                               |

### Production hardening checklist

- [ ] `node scripts/check-env.js` and `node backend/scripts/check-env.js` both pass
- [ ] All five JWT secrets are distinct, ≥32 chars, and not the shipped placeholders
- [ ] `MFA_ENCRYPTION_KEY` is set and stable across restarts and instances
- [ ] `EMAIL_UNSUBSCRIBE_SECRET` is not the default value
- [ ] `METRICS_TOKEN` is set
- [ ] `ALLOWED_ORIGINS` lists only production origins
- [ ] `SECRETS_BACKEND=vault` with AppRole credentials, not `VAULT_TOKEN`
- [ ] `AML_PROVIDER` is not `mock`
- [ ] `REDIS_URL` reachable — confirm webhook and email deliveries are flowing
- [ ] `ESCROW_CONTRACT_ID` matches the deployed mainnet contract
- [ ] No `CHAOS_*` variables set

---

## Known configuration gaps

Accurate as of this document's last update. Verify with:

```bash
# Declared in the template but never read
comm -23 \
  <(grep -oP '^[A-Z0-9_]+(?==)' backend/.env.example | sort -u) \
  <(grep -rhoP 'process\.env\.[A-Z0-9_]+' backend --include='*.js' | sed 's/process.env.//' | sort -u)
```

**Declared in `backend/.env.example` but read nowhere in the repository.** Setting
these has no effect; they are most likely leftovers from removed features:

`EMAIL_MAX_RETRIES`, `EMAIL_QUEUE_POLL_INTERVAL_MS`, `EMAIL_RATE_LIMIT_PER_MINUTE`,
`EMAIL_RETRY_BASE_DELAY_MS`, `JWT_REFRESH_EXPIRATION`, `STELLAR_NETWORK_PASSPHRASE`,
`TRUSTCHAIN_FEE_BPS`, `TRUSTCHAIN_TREASURY_ADDRESS`, `TRUSTCHAIN_MAX_ESCROW_AMOUNT`,
`TRUSTCHAIN_MIN_ESCROW_AMOUNT`.

> `JWT_REFRESH_EXPIRATION` is a notable trap — refresh-token lifetime is **not**
> configurable despite the template suggesting otherwise.

**Required by the prestart validator but read by no runtime code.** `MFA_SECRET`
and `CONTRACT_ID` must be set for `npm start` to succeed, yet the application reads
`MFA_JWT_SECRET` and `ESCROW_CONTRACT_ID` instead. Set both pairs until the
validator is reconciled with the code.

**Read by the code but absent from `backend/.env.example`.** Roughly a hundred
variables fall into this group, all documented above; the ones most worth adding to
your own deployment template are `MFA_ENCRYPTION_KEY`, `METRICS_TOKEN`,
`QUEUE_CONCURRENCY`, `READ_REPLICA_URLS`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`,
`TRACING_ENABLED`, and the `WEBHOOK_*` family.

**Duplicated keys.** `backend/.env.example` declares `ESCROW_CONTRACT_ID`,
`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, and `BACKUP_S3_BUCKET` more than once. The
last occurrence wins under `dotenv`.

---

## Troubleshooting

| Symptom                                                    | Cause and fix                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `JWT_SECRET env var is required` at startup                 | A required secret is missing and `NODE_ENV` is not `test`. Set all five, distinct and ≥32 chars. |
| `npm start` fails on `MFA_SECRET — MISSING` or `CONTRACT_ID — MISSING` | The prestart validator uses names no runtime code reads. Set them alongside `MFA_JWT_SECRET` and `ESCROW_CONTRACT_ID`. |
| `contains a known insecure default ("secret")`              | Substring match — your generated value literally contains `secret` or `password`. Regenerate with `openssl rand -hex 32`. |
| `check-env` fails with "uses a known placeholder value"     | A `change_this_*` value from the template reached the environment. Generate real secrets.     |
| `check-env` fails with "duplicates"                         | Two JWT secrets share a value. Generate each separately.                                      |
| CORS errors from the browser                                | The frontend origin is missing from `ALLOWED_ORIGINS`. Credentials are enabled, so it must be an exact match. |
| Prisma migrations hang or fail while the app works          | `DIRECT_URL` points at a pooler. It must be a direct, non-pooled connection.                  |
| Webhooks and emails never send                              | No reachable Redis. `REDIS_URL` is required for BullMQ — the in-memory fallback covers only cache and rate limits. |
| Indexer logs `indexer_escrow_contract_id_unset`             | `ESCROW_CONTRACT_ID` is empty. No events are indexed, so no webhooks fire.                    |
| Users must re-enrol MFA after every deploy                  | `MFA_ENCRYPTION_KEY` is unset, so a random key is generated per boot and stored TOTP secrets become undecryptable. |
| `/metrics` is publicly readable                             | `METRICS_TOKEN` is unset. Set it in any environment reachable from outside.                   |
| Search returns results but ignores relevance ranking        | Elasticsearch is unreachable and the Postgres fallback is serving. Check `ELASTICSEARCH_URL`. |
| Changing `NEXT_PUBLIC_*` has no effect                      | Those values are inlined at build time. Rebuild the frontend — a restart is not enough.       |
| A secret is visible in the browser bundle                   | It was given a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefix. Rotate it, then move it server-side.  |
| A variable you set does nothing                             | Check it against [Known configuration gaps](#known-configuration-gaps) — it may be a dead key. |
