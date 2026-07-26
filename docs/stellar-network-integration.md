# Stellar Network Integration and Testnet Setup

**Audience:** developers setting up a local development environment and operators deploying to Stellar testnet or mainnet.

Related reading:

- [Production Deployment Guide](../production-deployment-guide.md) — production deployment procedures
- [Configuration Reference](../configuration.md) — environment variables for Stellar configuration
- [Smart Contract Guide](../smart-contract-guide.md) — Soroban contract development

---

## Table of Contents

1. [Overview](#overview)
2. [Stellar Networks](#stellar-networks)
3. [Local Sandbox Setup](#local-sandbox-setup)
4. [Testnet Setup](#testnet-setup)
5. [Mainnet Setup](#mainnet-setup)
6. [Contract Deployment](#contract-deployment)
7. [Wallet and Key Management](#wallet-and-key-management)
8. [Troubleshooting](#troubleshooting)
9. [Cross-References](#cross-references)

---

## Overview

Trustchain Escrow runs on the Stellar network using Soroban smart contracts. The platform supports three network environments:

| Environment | Use Case | RPC Endpoint | Horizon |
| ----------- | -------- | ------------ | ------- |
| **Local** | Development and testing | `http://localhost:8001` | `http://localhost:8000` |
| **Testnet** | Pre-production testing | `https://soroban-testnet.stellar.org` | `https://horizon-testnet.stellar.org` |
| **Mainnet** | Production | `https://soroban-rpc.mainnet.stellar.org` | `https://horizon.stellar.org` |

---

## Stellar Networks

### Soroban RPC

Soroban RPC is the primary interface for interacting with Soroban smart contracts on Stellar. It provides:

- Contract invocation (read and write)
- Transaction submission
- Event subscription
- Ledger data access

### Horizon

Horizon is the Stellar network's REST API. It provides:

- Account and transaction history
- Fee statistics
- Network health checks
- Friendbot (testnet only) for funding test accounts

### Network Passphrases

Each Stellar network has a unique passphrase that signs transactions:

| Network | Passphrase |
| ------- | ---------- |
| Local | `Standalone Network ; February 2017` |
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

---

## Local Sandbox Setup

The fastest way to get a local Stellar environment running is the Stellar Quickstart sandbox with Soroban support.

### Prerequisites

- Docker and Docker Compose
- Node.js 20+
- Rust toolchain with `wasm32-unknown-unknown` target
- Stellar CLI (optional, for contract deployment)

### Quick Start

Run the provided sandbox script:

```bash
bash scripts/start-sandbox.sh
```

This script:

1. Starts the Stellar Quickstart container with Soroban RPC enabled
2. Waits for Horizon to become healthy
3. Configures the `soroban-cli` network profile named `local`
4. Provisions pre-funded test wallets (client, freelancer, arbiter)
5. Builds and deploys the escrow contract to the local network
6. Patches `frontend/.env.local` with the local network settings

### Manual Sandbox Setup

If you prefer to set up the sandbox manually:

```bash
# 1. Start the Stellar Quickstart container
docker compose up -d stellar

# 2. Wait for Horizon to be ready
curl -sf http://localhost:8000/health

# 3. Configure soroban-cli
soroban network add \
  --rpc-url http://localhost:8001 \
  --network-passphrase "Standalone Network ; February 2017" \
  local

# 4. Fund a test account
curl -sf "http://localhost:8000/friendbot?addr=<ACCOUNT_ADDRESS>"

# 5. Deploy the contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source <source-keypair> \
  --network local
```

### Environment Variables for Local Development

```bash
NEXT_PUBLIC_STELLAR_NETWORK=local
NEXT_PUBLIC_HORIZON_URL=http://localhost:8000
NEXT_PUBLIC_SOROBAN_RPC_URL=http://localhost:8001
NEXT_PUBLIC_NETWORK_PASSPHRASE="Standalone Network ; February 2017"
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CONTRACT_ID=<deployed-contract-id>
```

---

## Testnet Setup

### Prerequisites

- Stellar CLI installed (`cargo install soroban-cli`)
- A funded testnet account (use Friendbot)

### Getting a Funded Testnet Account

```bash
# Generate a keypair
soroban keys generate testnet-wallet --network testnet

# Fund via Friendbot
curl -sf "https://friendbot.stellar.org/?addr=$(soroban keys address testnet-wallet --network testnet)"
```

### Deploying to Testnet

```bash
# Set the network environment variable
export STELLAR_NETWORK=testnet
export STELLAR_KEY=testnet-wallet

# Run the deployment script
bash scripts/deploy.sh
```

Or deploy manually:

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source testnet-wallet \
  --network testnet
```

### Testnet Environment Variables

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_CONTRACT_ID=<testnet-contract-id>
```

---

## Mainnet Setup

### Prerequisites

- Stellar CLI installed
- A funded mainnet account with sufficient XLM for transaction fees
- A completed security audit of the smart contract
- Mainnet contract address recorded in `backend/.env` and `frontend/.env.production`

### Deploying to Mainnet

```bash
export STELLAR_NETWORK=mainnet
export STELLAR_KEY=<mainnet-keypair>

bash scripts/deploy.sh
```

### Mainnet Environment Variables

```bash
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
NEXT_PUBLIC_CONTRACT_ID=<mainnet-contract-id>
```

### Mainnet Safety Checklist

- [ ] Smart contract audit completed
- [ ] Admin keys stored in a secure vault (not in `.env` files)
- [ ] Contract verified on StellarExpert or similar explorer
- [ ] Testnet deployment tested end-to-end
- [ ] Backup and recovery procedures documented
- [ ] Monitoring and alerting configured for mainnet

---

## Contract Deployment

### Build the WASM

```bash
cd contracts/escrow_contract
cargo build --release --target wasm32-unknown-unknown
cd -
```

### Deploy Script

The `scripts/deploy.sh` script handles building and deploying to the configured network:

```bash
# Deploy to testnet (default)
bash scripts/deploy.sh

# Deploy to mainnet
STELLAR_NETWORK=mainnet bash scripts/deploy.sh
```

### Contract Initialization

After deployment, initialize the contract with the admin address:

```bash
soroban contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network <network> \
  -- initialize \
  --admin "$(soroban keys address <admin-keypair>)"
```

### Verifying Deployment

```bash
soroban contract call \
  --id <contract-id> \
  --source <admin-keypair> \
  --network <network> \
  -- get_admin
```

---

## Wallet and Key Management

### Generating Keypairs

```bash
# Local network
soroban keys generate local-admin --network local

# Testnet
soroban keys generate testnet-admin --network testnet

# Mainnet
soroban keys generate mainnet-admin --network mainnet
```

### Funding Accounts (Testnet Only)

```bash
# Friendbot for testnet
curl -sf "https://friendbot.stellar.org/?addr=<ACCOUNT_ADDRESS>"

# Friendbot for local sandbox
curl -sf "http://localhost:8000/friendbot?addr=<ACCOUNT_ADDRESS>"
```

### Viewing Account Balance

```bash
soroban keys address <keypair-name> --network <network>
```

---

## Troubleshooting

### Sandbox Won't Start

```bash
# Check if the container is running
docker ps | grep stellar

# Check container logs
docker compose logs stellar

# Reset and restart
bash scripts/start-sandbox.sh --reset
bash scripts/start-sandbox.sh
```

### Contract Deployment Fails

- Ensure the account has sufficient XLM for the transaction fee (minimum 1 XLM on testnet)
- Verify the network passphrase matches the target network
- Check that the WASM file was built for the correct target (`wasm32-unknown-unknown`)

### Horizon Not Responding

```bash
# Check Horizon health
curl http://localhost:8000/health

# Check container status
docker compose ps stellar

# Restart the Stellar container
docker compose restart stellar
```

### Soroban CLI Not Found

```bash
# Install soroban-cli
cargo install soroban-cli

# Verify installation
soroban --version
```

### Transaction Stuck or Timing Out

- Check the Stellar network status at [stellar.expert](https://stellar.expert)
- Verify the account sequence number is correct
- Ensure the network passphrase matches the target network

---

## Cross-References

- [Production Deployment Guide](../production-deployment-guide.md) — production deployment procedures
- [Configuration Reference](../configuration.md) — environment variables for Stellar configuration
- [Smart Contract Guide](../smart-contract-guide.md) — Soroban contract development
- [Docker Compose Configuration](../docker-compose.yml) — local infrastructure setup