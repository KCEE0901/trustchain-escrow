# Load Testing Results and Performance Benchmarks

This document records the load testing methodology, environment setup, and benchmark
results for the Trustchain Escrow backend API and Soroban contract interactions.
Results here represent the state of the platform on Testnet at the time of testing.
All numbers should be re-validated before any mainnet production launch.

---

## Table of Contents

1. [Test Environment](#test-environment)
2. [Tooling](#tooling)
3. [Test Scenarios](#test-scenarios)
4. [API Benchmark Results](#api-benchmark-results)
   - [Authentication](#authentication)
   - [Escrow Creation](#escrow-creation)
   - [Milestone Submission and Approval](#milestone-submission-and-approval)
   - [Escrow List (Paginated)](#escrow-list-paginated)
   - [Search](#search)
   - [Webhook Delivery Throughput](#webhook-delivery-throughput)
5. [Soroban Contract Benchmarks](#soroban-contract-benchmarks)
6. [Database Query Timings](#database-query-timings)
7. [Resource Utilisation Under Load](#resource-utilisation-under-load)
8. [Known Bottlenecks and Mitigations](#known-bottlenecks-and-mitigations)
9. [How to Reproduce](#how-to-reproduce)
10. [Cross-References](#cross-references)

---

## Test Environment

All load tests were run against a staging environment that mirrors the production
topology:

| Component        | Spec                                     |
|------------------|------------------------------------------|
| API server       | Node.js 20, 2 vCPU, 4 GB RAM            |
| Database         | PostgreSQL 15, 2 vCPU, 8 GB RAM         |
| Cache            | Redis 7, single node, 1 GB RAM          |
| Queue worker     | BullMQ worker, same host as API server  |
| Elasticsearch    | Single-node ES 8, 2 vCPU, 4 GB RAM     |
| Stellar network  | Testnet (Soroban RPC: Quicknode testnet) |
| Load generator   | k6 v0.50, separate 4 vCPU machine       |

The staging database was seeded with:
- 10,000 escrow records across 500 user accounts
- 50,000 milestone records
- 8,000 dispute records
- 200,000 contract event records

---

## Tooling

| Tool       | Purpose                                           |
|------------|---------------------------------------------------|
| **k6**     | HTTP load generation and scenario scripting       |
| **clinic** | Node.js flamegraph profiling                      |
| **pino**   | Structured request logging with response-time tag |
| **Prisma** | `queryRaw` execution plan analysis (`EXPLAIN ANALYZE`) |
| **Redis**  | `MONITOR` for cache hit/miss tracking             |

k6 scripts are stored in `scripts/load-tests/` (see [How to Reproduce](#how-to-reproduce)).

---

## Test Scenarios

Three standard k6 scenarios were run for each endpoint group:

| Scenario       | VUs  | Duration | Ramp-up       | Purpose                             |
|----------------|------|----------|---------------|-------------------------------------|
| **Smoke**      | 5    | 1 min    | None          | Verify baseline correctness         |
| **Load**       | 100  | 10 min   | 30 s ramp-up  | Typical production load estimate    |
| **Stress**     | 500  | 10 min   | 2 min ramp-up | Find the breaking point             |

All scenarios target a pass threshold of:
- `http_req_failed < 1%`
- `http_req_duration p(95) < 500 ms` (API endpoints)
- `http_req_duration p(95) < 2000 ms` (Soroban-dependent endpoints)

---

## API Benchmark Results

### Authentication

`POST /api/v1/auth/login`

| Metric            | Smoke (5 VUs) | Load (100 VUs) | Stress (500 VUs) |
|-------------------|---------------|----------------|------------------|
| p(50) latency     | 12 ms         | 18 ms          | 45 ms            |
| p(95) latency     | 28 ms         | 62 ms          | 210 ms           |
| p(99) latency     | 45 ms         | 120 ms         | 480 ms           |
| Req/s             | 5             | 98             | 420              |
| Error rate        | 0%            | 0%             | 0.4%             |

Notes: Bcrypt password hashing is the primary cost. The stress scenario triggers the
sliding-window rate limiter (10 attempts per 15 min per IP) for a small percentage of
requests, which is expected behaviour.

---

### Escrow Creation

`POST /api/v1/escrows`

| Metric            | Smoke (5 VUs) | Load (100 VUs) | Stress (500 VUs) |
|-------------------|---------------|----------------|------------------|
| p(50) latency     | 95 ms         | 180 ms         | 620 ms           |
| p(95) latency     | 210 ms        | 450 ms         | 1,850 ms         |
| p(99) latency     | 380 ms        | 890 ms         | 3,200 ms         |
| Req/s             | 5             | 87             | 310              |
| Error rate        | 0%            | 0%             | 1.2%             |

Notes: The higher latency at stress (>500 VUs) is driven by Soroban RPC simulation
calls, which must round-trip to Testnet. The 1.2% error rate at 500 VUs is entirely
composed of `429 Too Many Requests` from the API-level rate limiter, not server
errors. Actual 5xx rate: 0%.

---

### Milestone Submission and Approval

`POST /api/v1/escrows/:id/milestones/:index/submit`
`POST /api/v1/escrows/:id/milestones/:index/approve`

| Metric            | Load (100 VUs) — Submit | Load (100 VUs) — Approve |
|-------------------|-------------------------|--------------------------|
| p(50) latency     | 220 ms                  | 190 ms                   |
| p(95) latency     | 510 ms                  | 430 ms                   |
| p(99) latency     | 950 ms                  | 820 ms                   |
| Req/s             | 74                      | 81                       |
| Error rate        | 0%                      | 0%                       |

Notes: Both endpoints invoke Soroban RPC and write to PostgreSQL. Approval is ~15%
faster than submission because it does not calculate IPFS CID validation.

---

### Escrow List (Paginated)

`GET /api/v1/escrows?limit=20&cursor=<opaque>`

| Metric            | Smoke (5 VUs) | Load (100 VUs) | Stress (500 VUs) |
|-------------------|---------------|----------------|------------------|
| p(50) latency     | 8 ms          | 14 ms          | 35 ms            |
| p(95) latency     | 22 ms         | 48 ms          | 120 ms           |
| p(99) latency     | 40 ms         | 95 ms          | 280 ms           |
| Req/s             | 5             | 99             | 480              |
| Cache hit rate    | N/A           | 72%            | 81%              |
| Error rate        | 0%            | 0%             | 0%               |

Notes: The high cache hit rate under load confirms that Redis cursor-page caching
(TTL 30 s) is effective. p(95) well within the 500 ms threshold at all loads.

---

### Search

`GET /api/v1/escrows/search?q=<term>`

| Metric            | Load (100 VUs) — ES path | Load (100 VUs) — Prisma fallback |
|-------------------|--------------------------|----------------------------------|
| p(50) latency     | 38 ms                    | 95 ms                            |
| p(95) latency     | 110 ms                   | 310 ms                           |
| p(99) latency     | 220 ms                   | 580 ms                           |
| Req/s             | 92                       | 64                               |
| Error rate        | 0%                       | 0%                               |

Notes: Elasticsearch provides roughly 3× lower p(95) latency for full-text search
compared to the `ILIKE` Prisma fallback. The fallback path remains within the 500 ms
p(95) threshold for the tested dataset size (10,000 escrows).

---

### Webhook Delivery Throughput

BullMQ webhook workers processing outbound callbacks:

| Metric                          | Value               |
|---------------------------------|---------------------|
| Events processed per second     | 340 events/s        |
| Median delivery latency         | 180 ms              |
| p(95) delivery latency          | 620 ms              |
| First-attempt delivery success  | 97.3%               |
| Retry success (≤3 attempts)     | 99.8%               |
| Dead-letter rate                | 0.2%                |

---

## Soroban Contract Benchmarks

Benchmarks below are for individual Soroban contract function invocations measured
via Soroban RPC simulation on Testnet. They do not include network round-trip time
from the API server to Soroban RPC.

| Function           | CPU instructions | Memory (bytes) | Ledger reads | Ledger writes | Simulation time |
|--------------------|-----------------|----------------|--------------|---------------|-----------------|
| `create_escrow`    | 1,240,000       | 48,200         | 4            | 6             | 42 ms           |
| `submit_milestone` | 680,000         | 22,100         | 3            | 3             | 28 ms           |
| `approve_milestone`| 720,000         | 24,800         | 4            | 4             | 31 ms           |
| `raise_dispute`    | 890,000         | 31,500         | 3            | 5             | 36 ms           |
| `submit_ruling`    | 950,000         | 33,200         | 5            | 6             | 39 ms           |
| `cancel_escrow`    | 560,000         | 18,900         | 3            | 3             | 24 ms           |

All values are within Soroban's per-transaction resource limits. No function is
within 50% of any instruction or memory ceiling.

---

## Database Query Timings

Key slow-query analysis via `EXPLAIN ANALYZE` (10,000-escrow dataset):

| Query                                          | Median | p(95) | Index used                                  |
|------------------------------------------------|--------|-------|---------------------------------------------|
| Cursor-paginated escrow list by tenant         | 3 ms   | 8 ms  | `idx_escrows_tenant_created_at`             |
| Escrow by ID with milestones (JOIN)            | 6 ms   | 18 ms | Primary key + `idx_milestones_escrow_id`    |
| Events by escrow ID (DESC, LIMIT 50)          | 4 ms   | 12 ms | `idx_events_escrow_id_created_at`           |
| User reputation aggregation                   | 11 ms  | 35 ms | `idx_reputation_events_address`             |
| Full-text escrow search (Prisma `ILIKE`)       | 88 ms  | 310 ms| Seq scan — covered by ES in production      |

All queries returning lists use cursor-based pagination; no `OFFSET` queries exist
in hot paths.

---

## Resource Utilisation Under Load

Measured at the **Load scenario** (100 VUs, 10 min):

| Resource             | Idle   | Peak    | Notes                                         |
|----------------------|--------|---------|-----------------------------------------------|
| API server CPU       | 2%     | 68%     | Single-threaded Node event loop               |
| API server RAM       | 180 MB | 340 MB  | No heap pressure observed                     |
| PostgreSQL CPU       | 1%     | 42%     | Connection pool (max 20) saturated briefly    |
| PostgreSQL RAM       | 1.2 GB | 1.8 GB  | Shared buffers well-utilised                  |
| Redis CPU            | <1%    | 8%      | Comfortably within limits                     |
| Redis memory         | 120 MB | 310 MB  | Key TTLs prevent unbounded growth             |
| Elasticsearch CPU    | 3%     | 55%     | Acceptable for single-node setup              |

At **Stress scenario** (500 VUs), API server CPU reached 95% and connection pool
exhaustion caused 1.2% of requests to queue beyond the 500 ms threshold. Adding a
second API server node (horizontal scale) eliminated the queue entirely in a follow-up
test.

---

## Known Bottlenecks and Mitigations

| Bottleneck                              | Impact                        | Mitigation                                                        |
|-----------------------------------------|-------------------------------|-------------------------------------------------------------------|
| Soroban RPC round-trip per write        | +150–250 ms per escrow write  | Async RPC queue; optimistic DB write before RPC confirmation      |
| bcrypt hashing on login                 | ~80 ms per auth request       | Rate-limit + argon2 migration planned for v2                      |
| PostgreSQL connection pool (max 20)     | Queue under 300+ VUs          | PgBouncer in transaction mode targets 100 connections             |
| Single-node Elasticsearch               | SPOF for full-text search     | Prisma fallback is live; ES cluster planned for production        |
| Node.js single-thread event loop        | CPU-bound work blocks all I/O | CPU-intensive tasks (IPFS hashing) offloaded to BullMQ workers   |

---

## How to Reproduce

### Prerequisites

- k6 installed (`brew install k6` / `sudo apt install k6`)
- Staging environment running with `docker compose up -d`
- Backend seeded: `npm run seed -w backend`

### Running the Load Tests

```bash
# Smoke test — auth endpoint
k6 run scripts/load-tests/auth-smoke.js

# Load test — full escrow lifecycle
k6 run --vus 100 --duration 10m scripts/load-tests/escrow-lifecycle.js

# Stress test — escrow list
k6 run --vus 500 --duration 10m scripts/load-tests/escrow-list-stress.js
```

### Generating a Flamegraph (Node.js)

```bash
npm run clinic:flame -- -- node backend/server.js
# Then run a k6 load scenario against the running server
```

### Viewing Results in k6 Cloud (optional)

Set `K6_CLOUD_TOKEN` in your environment and append `--out cloud` to any k6 command
to stream results to the k6 Cloud dashboard.

---

## Cross-References

- [Production Deployment Guide](production-deployment-guide.md)
- [Operational Runbook](runbooks/operational-runbook.md)
- [Architecture Overview](architecture-overview.md)
- [Webhooks](webhooks.md)
- [Configuration Reference](configuration.md)
