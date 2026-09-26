# Production Deployment Guide

This guide details the procedures for deploying Trustchain Escrow to production environments, including smart contract compilation and deployment on Stellar, backend services, database setup, reverse proxy configuration, and monitoring.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites & System Requirements](#prerequisites--system-requirements)
3. [Environment Configuration](#environment-configuration)
4. [Smart Contract Deployment (Soroban)](#smart-contract-deployment-soroban)
   - [Wasm Compilation & Optimization](#wasm-compilation--optimization)
   - [Stellar Network Deployment](#stellar-network-deployment)
5. [Database Setup & Migrations](#database-setup--migrations)
6. [Containerized Deployment (Docker)](#containerized-deployment-docker)
7. [Reverse Proxy & SSL/TLS](#reverse-proxy--ssltls)
8. [Monitoring & Health Checks](#monitoring--health-checks)
9. [Backup & Disaster Recovery](#backup--disaster-recovery)
10. [Cross-References](#cross-references)

---

## Architecture Overview

A production Trustchain Escrow stack comprises the following components:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Nginx / Reverse Proxy (SSL / TLS termination, HTTP/2, Rate Limiting)    │
└────────────────┬────────────────────────────────────────┬───────────────┘
                 │                                        │
┌────────────────▼──────────────┐        ┌────────────────▼───────────────┐
│ Next.js Frontend              │        │ Express.js REST API Backend    │
│ (Port 3000 / Static Bundle)   │        │ (Port 4000 / Node 20 Cluster)  │
└───────────────────────────────┘        └────────────────┬───────────────┘
                                                          │
          ┌───────────────────────┬───────────────────────┼───────────────────────┐
          │                       │                       │                       │
┌─────────▼───────────┐ ┌─────────▼───────────┐ ┌─────────▼───────────┐ ┌─────────▼───────────┐
│ PostgreSQL 16       │ │ Redis 7             │ │ Elasticsearch 8     │ │ Soroban RPC Node    │
│ Primary DB (Prisma) │ │ Rate Limit & Queues │ │ Escrow Search Index │ │ Stellar Mainnet     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

---

## Prerequisites & System Requirements

### Hardware Recommendations

| Component | Minimum | Recommended |
| :--- | :--- | :--- |
| **CPU** | 2 vCPU | 4+ vCPU |
| **RAM** | 4 GB | 8 GB+ |
| **Disk** | 40 GB SSD | 100 GB+ NVMe SSD |

### Software Dependencies
- **Node.js**: `v20.x` LTS or higher
- **Docker & Docker Compose**: Docker `v24+`, Compose `v2+`
- **Stellar CLI**: `v21.0+`
- **Rust Toolchain**: `stable` with `wasm32-unknown-unknown` target

---

## Environment Configuration

Configure production environment variables in `backend/.env` and `frontend/.env.production`.

```bash
# Backend Environment (backend/.env)
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://trustchain_user:STRONG_PASSWORD@db:5432/trustchain_prod?sslmode=require
REDIS_URL=redis://:STRONG_REDIS_PASSWORD@redis:6379/0
ELASTICSEARCH_NODE=http://elasticsearch:9200
JWT_SECRET=SUPER_SECRET_JWT_SIGNING_KEY_32BYTES
SOROBAN_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org
ESCROW_CONTRACT_ID=CC...PROD_CONTRACT_ID
```

Refer to [docs/configuration.md](configuration.md) for the complete catalogue of variables and validation rules.

---

## Smart Contract Deployment (Soroban)

### Wasm Compilation & Optimization

Compile the Soroban contract to WebAssembly:

```bash
cd contracts/escrow_contract
cargo build --target wasm32-unknown-unknown --release
```

Optimize the Wasm binary to minimize gas costs and storage footprint:

```bash
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm
```

### Stellar Network Deployment

Deploy the contract using Stellar CLI:

```bash
# 1. Install contract code
WASM_HASH=$(stellar contract install \
  --source-account PROD_ADMIN_SECRET \
  --rpc-url https://soroban-rpc.mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.optimized.wasm)

# 2. Deploy contract instance
CONTRACT_ID=$(stellar contract deploy \
  --source-account PROD_ADMIN_SECRET \
  --rpc-url https://soroban-rpc.mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --wasm-hash $WASM_HASH)

echo "Deployed Contract ID: $CONTRACT_ID"
```

Initialize contract state with admin address:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account PROD_ADMIN_SECRET \
  --rpc-url https://soroban-rpc.mainnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  -- init \
  --admin PROD_ADMIN_ADDRESS
```

---

## Database Setup & Migrations

Execute database migrations against the production PostgreSQL instance:

```bash
# Run Prisma database migrations
npm run db:migrate -w backend

# Generate Prisma client bindings
npm run db:generate -w backend
```

---

## Containerized Deployment (Docker)

Use `docker-compose.yml` to launch production services:

```bash
# Build containers
docker compose -f docker-compose.yml build

# Start services in detached mode
docker compose -f docker-compose.yml up -d

# Verify container status
docker compose ps
```

---

## Reverse Proxy & SSL/TLS

Example Nginx server block (`/etc/nginx/sites-available/trustchain`):

```nginx
server {
    listen 443 ssl http2;
    server_name escrow.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/escrow.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/escrow.yourdomain.com/privkey.pem;

    location /api/ {
        proxy_pass http://localhost:4000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Monitoring & Health Checks

- **Health Check Endpoint**: `GET /api/v1/health` returns status of DB, Redis, and Soroban RPC connectivity.
- **Metrics**: Prometheus metrics exported on `/metrics`.
- **Logs**: Access Docker logs via `docker compose logs -f backend`.

---

## Backup & Disaster Recovery

- **PostgreSQL Backup**: Daily automated `pg_dump` snapshots stored in secure S3 buckets.
- **Redis Persistence**: AOF (Append Only File) enabled for BullMQ queue resilience.
- **Disaster Recovery**: Refer to [docs/disaster-recovery.md](disaster-recovery.md) for full failover procedures.

---

## Cross-References

- [Configuration Documentation](configuration.md) — Complete environment variable settings.
- [Disaster Recovery Plan](disaster-recovery.md) — Backup and failover runbooks.
- [Smart Contract Guide](smart-contract-guide.md) — Soroban contract compilation details.
- [Security Model](security-model.md) — Production security guidelines.
