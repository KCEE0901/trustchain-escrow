# Developer Onboarding & Local Setup Guide

Welcome to **Trustchain Escrow**! This guide will take you step-by-step through setting up your complete local development environment, running all system services (Smart Contracts, Backend API, Database, Indexer, and Frontend), executing tests, and troubleshooting common issues.

---

## Table of Contents

1. [System Prerequisites](#system-prerequisites)
2. [Repository Setup](#repository-setup)
3. [Environment Configuration](#environment-configuration)
4. [Infrastructure Setup (Docker Compose)](#infrastructure-setup-docker-compose)
5. [Database Migrations & Seeding](#database-migrations--seeding)
6. [Smart Contract Build & Deployment](#smart-contract-build--deployment)
7. [Running System Services](#running-system-services)
   - [Backend API Gateway](#1-backend-api-gateway)
   - [Event Indexer & Workers](#2-event-indexer--workers)
   - [Frontend Web Application](#3-frontend-web-application)
8. [Testing & Quality Verification](#testing--quality-verification)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Cross-References](#cross-references)

---

## System Prerequisites

Before starting, ensure your local development machine has the following tools installed:

| Tool | Recommended Version | Verification Command | Description |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>= 20.x` (LTS) | `node -v` | JavaScript runtime environment. |
| **npm / pnpm** | `npm >= 10.x` / `pnpm >= 9.x` | `npm -v` | Node package manager. |
| **Rust Toolchain** | `>= 1.74` | `rustc --version` | Compiler for Soroban smart contracts. |
| **wasm32 Target** | `wasm32-unknown-unknown` | `rustup target list \| grep wasm32` | Compilation target for WASM contracts. |
| **Soroban / Stellar CLI**| `>= 20.0.0` | `stellar --version` or `soroban --version` | CLI tool for Soroban smart contract interaction. |
| **Docker & Compose** | Docker `>= 24.x` | `docker --version` & `docker compose version` | Containerization platform for local services. |
| **Git** | `>= 2.34` | `git --version` | Version control. |

### Installing Required Rust Target

If `wasm32-unknown-unknown` is not installed, run:
```bash
rustup target add wasm32-unknown-unknown
```

---

## Repository Setup

Clone the Trustchain Escrow repository and enter the workspace directory:

```bash
# Clone the repository
git clone https://github.com/KCEE0901/trustchain-escrow.git
cd trustchain-escrow

# Fetch all submodules (if applicable)
git submodule update --init --recursive
```

---

## Environment Configuration

Copy the example environment files for both backend and frontend components.

```bash
# Backend environment setup
cp backend/.env.example backend/.env

# Workspace root environment setup (if applicable)
cp .env.example .env 2>/dev/null || true
```

### Essential Environment Variables (`backend/.env`)

Ensure the following key parameters are correctly set in `backend/.env`:

```env
# Server Port & Mode
PORT=4000
NODE_ENV=development

# Database Connection (PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/trustchain_escrow?schema=public"

# Redis Connection (Cache & Queues)
REDIS_URL="redis://localhost:6379"

# Stellar Network & Soroban Configuration
STELLAR_NETWORK=standalone
STELLAR_RPC_URL="http://localhost:8000/soroban/rpc"
ESCROW_CONTRACT_ID="C..."
GOVERNANCE_CONTRACT_ID="C..."

# JWT Security Secrets
JWT_SECRET="dev_jwt_secret_key_change_in_production_32_chars!"
JWT_REFRESH_SECRET="dev_refresh_secret_key_change_in_production_32_chars!"
ADMIN_API_KEY="dev_admin_api_key_123"

# IPFS Storage Node
IPFS_GATEWAY_URL="http://localhost:8080/ipfs/"
IPFS_API_URL="http://localhost:5001"
```

---

## Infrastructure Setup (Docker Compose)

Start the local infrastructure stack containing **PostgreSQL**, **Redis**, **IPFS (Kubo)**, and local **Stellar Quickstart standalone node**:

```bash
# Spin up infrastructure containers in detached mode
docker compose up -d

# Verify container statuses
docker compose ps
```

Expected running containers:
- `trustchain-db` (PostgreSQL on port `5432`)
- `trustchain-redis` (Redis on port `6379`)
- `trustchain-ipfs` (IPFS API on port `5001`, Gateway on port `8080`)
- `trustchain-stellar` (Stellar Standalone network on port `8000`)

---

## Database Migrations & Seeding

Initialize the PostgreSQL database schema using Prisma:

```bash
cd backend

# Install backend dependencies
npm install

# Run database migrations
npx prisma migrate dev --name init

# Generate Prisma Client types
npx prisma generate

# Seed initial development data (test users, initial reputation profiles)
npm run seed

cd ..
```

---

## Smart Contract Build & Deployment

Build the Soroban smart contracts and deploy them to your local standalone network.

### 1. Build Smart Contracts

```bash
# Navigate to the escrow contract crate
cd contracts/escrow_contract

# Run unit tests to ensure clean contract code
cargo test

# Build optimized WebAssembly binary
cargo build --release --target wasm32-unknown-unknown

cd ../..
```

The compiled binary will be located at:
`target/wasm32-unknown-unknown/release/escrow_contract.wasm`

### 2. Deploy to Local Soroban Network

Use the helper script or `stellar` CLI to deploy the contract and initialize instance storage:

```bash
# Option A: Using the automated helper script
bash scripts/deploy-contracts.sh --network standalone

# Option B: Manual deployment with Stellar CLI
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source S... (secret key) \
  --network standalone
```

Update the resulting `ESCROW_CONTRACT_ID` inside your `backend/.env` file.

---

## Running System Services

Open separate terminal windows or use a process manager (e.g., `tmux` or `concurrently`) to start the services:

### 1. Backend API Gateway
```bash
cd backend
npm run dev
```
- API will start at [`http://localhost:4000`](http://localhost:4000)
- Interactive OpenAPI Swagger UI: [`http://localhost:4000/api/docs`](http://localhost:4000/api/docs)

### 2. Event Indexer & Workers
```bash
cd backend
npm run worker:indexer
```
- Listens to Soroban contract event logs and syncs transaction states into PostgreSQL.

### 3. Frontend Web Application
```bash
cd frontend
npm install
npm run dev
```
- Web Application will start at [`http://localhost:3000`](http://localhost:3000)

---

## Testing & Quality Verification

Run the comprehensive test suites across all project layers to ensure everything operates correctly:

### Backend Unit & Integration Tests
```bash
cd backend
npm test
```

### Smart Contract Rust Tests
```bash
cd contracts/escrow_contract
cargo test -- --nocapture
```

### Run All Workspace Contract Tests
```bash
cargo test --workspace
```

---

## Troubleshooting Guide

### Issue 1: Database Connection Refused (`ECONNREFUSED 127.0.0.1:5432`)
- **Cause**: PostgreSQL Docker container is not running or initializing.
- **Fix**: Check container state with `docker compose ps` and view logs using `docker compose logs db`. Ensure port `5432` is not occupied by a local PostgreSQL instance (`sudo systemctl stop postgresql`).

### Issue 2: `wasm32-unknown-unknown` Target Missing
- **Error**: `error[E0463]: can't find crate for std` during contract compilation.
- **Fix**: Run `rustup target add wasm32-unknown-unknown`.

### Issue 3: Soroban Contract Deployment Timeout or Low Balance
- **Cause**: The test account on local standalone network lacks XLM test funds.
- **Fix**: Request friendbot test tokens for your source key:
  ```bash
  curl "http://localhost:8000/friendbot?addr=<YOUR_PUBLIC_KEY>"
  ```

### Issue 4: Indexer Out of Sync / Missing Contract Events
- **Cause**: Contract ID mismatch between deployed WASM and `backend/.env`.
- **Fix**: Copy the exact contract ID printed during `deploy-contracts.sh` into `ESCROW_CONTRACT_ID` in `backend/.env` and restart `npm run worker:indexer`.

---

## Cross-References

- [Contributing Guidelines](../CONTRIBUTING.md) — Code formatting standards, git branch naming, and pull request workflow.
- [Comprehensive REST API Reference](api-reference.md) — Endpoint specs and parameters.
- [Smart Contract ABI & Entry Point Reference](smart-contract-abi.md) — Function signatures and parameter types.
- [Architecture Overview](architecture-overview.md) — System component diagrams and data flow sequences.
- [Configuration Reference](configuration.md) — Exhaustive list of environment variables.
