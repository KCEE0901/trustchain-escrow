# Operational Runbook

This runbook covers the common operational tasks for running and maintaining the Trustchain Escrow platform. It is intended for operators, on-call engineers, and DevOps personnel.

Related reading:

- [Incident Response Guide](../incidents/README.md) — severity definitions and incident lifecycle
- [Production Deployment Guide](../production-deployment-guide.md) — deployment procedures
- [Monitoring Setup](../monitoring/setup.md) — metrics and alerting configuration
- [Disaster Recovery](../disaster-recovery.md) — backup and restore procedures

---

## Table of Contents

1. [Daily Operations](#daily-operations)
2. [Health Checks](#health-checks)
3. [Restarting Services](#restarting-services)
4. [Database Maintenance](#database-maintenance)
5. [Redis Maintenance](#redis-maintenance)
6. [Contract Upgrades](#contract-upgrades)
7. [Log Rotation and Disk Management](#log-rotation-and-disk-management)
8. [Certificate Renewal](#certificate-renewal)
9. [Scaling Operations](#scaling-operations)
10. [Backup Verification](#backup-verification)
11. [Cross-References](#cross-references)

---

## Daily Operations

### Checking System Health

Run the health check endpoint to verify all components are responding:

```bash
curl https://api.stellartrustescrow.com/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-07-26T12:00:00Z",
  "uptime": 86400,
  "version": "2.0.0",
  "components": {
    "database": "ok",
    "redis": "ok",
    "stellar": "ok",
    "elasticsearch": "ok"
  }
}
```

### Reviewing Logs

```bash
# Docker / systemd
journalctl -u stellar-trust-escrow -f --since "1 hour ago"

# Kubernetes
kubectl logs -l app=trustchain-escrow --since=1h

# Heroku
heroku logs --tail --app stellar-trust-escrow-api
```

### Monitoring Queue Backlog

Access the BullMQ dashboard or query Redis directly:

```bash
# List all queues
redis-cli KEYS "bull:*"

# Check queue length for webhooks
redis-cli LLEN bull:webhook:wait
redis-cli LLEN bull:webhook:active
redis-cli LLEN bull:webhook:failed
```

---

## Health Checks

### API Health

```bash
curl -s https://api.stellartrustescrow.com/health | jq .
```

### Database Connectivity

```bash
psql $DATABASE_URL -c "SELECT 1"
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();"
```

### Redis Connectivity

```bash
redis-cli PING
redis-cli INFO memory | grep used_memory_human
```

### Stellar Network Connectivity

```bash
# Testnet
curl -s https://soroban-testnet.stellar.org/health

# Mainnet
curl -s https://horizon.stellar.org/
```

### Elasticsearch Health

```bash
curl -s https://elasticsearch.stellartrustescrow.com/_cluster/health | jq .status
```

---

## Restarting Services

### Restart the Backend API

```bash
# Docker
docker compose restart backend

# Kubernetes
kubectl rollout restart deployment/trustchain-escrow-api

# systemd
sudo systemctl restart stellar-trust-escrow
```

### Restart the Frontend

```bash
# Docker
docker compose restart frontend

# Kubernetes
kubectl rollout restart deployment/trustchain-escrow-frontend
```

### Restart the Indexer

```bash
# Docker
docker compose restart indexer

# Kubernetes
kubectl rollout restart deployment/trustchain-escrow-indexer
```

### Graceful Restart with Zero Downtime

For production deployments, use a rolling restart to avoid downtime:

```bash
# Docker Compose
docker compose up -d --no-deps --build backend

# Kubernetes (already rolling by default)
kubectl rollout restart deployment/trustchain-escrow-api
```

---

## Database Maintenance

### Running Migrations

```bash
npm run db:migrate -w backend
```

### Generating Prisma Client

```bash
npm run db:generate -w backend
```

### Checking Database Size

```bash
psql $DATABASE_URL -c "
  SELECT
    pg_size_pretty(pg_database_size(current_database())) AS db_size,
    pg_size_pretty(pg_total_relation_size('escrow')) AS escrow_table_size,
    pg_size_pretty(pg_total_relation_size('dispute')) AS dispute_table_size;
"
```

### Identifying Slow Queries

```bash
psql $DATABASE_URL -c "
  SELECT query, calls, mean_exec_time, total_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"
```

### Vacuum and Analyze

```bash
psql $DATABASE_URL -c "VACUUM ANALYZE;"
```

### Connecting to the Database

```bash
psql $DATABASE_URL
```

---

## Redis Maintenance

### Checking Memory Usage

```bash
redis-cli INFO memory | grep -E "used_memory_human|used_memory_peak_human"
```

### Evicting Expired Keys

Redis handles expiration automatically. To force eviction of expired keys:

```bash
redis-cli MEMORY PURGE
```

### Viewing Key Count

```bash
redis-cli DBSIZE
```

### Inspecting a Specific Key

```bash
redis-cli TYPE tenant:acme:escrow:123
redis-cli TTL tenant:acme:escrow:123
redis-cli GET tenant:acme:escrow:123
```

### Flushing a Tenant's Cache

To clear all cache entries for a specific tenant:

```bash
redis-cli --scan --pattern "tenant:<slug>:*" | xargs -L 1 redis-cli DEL
```

---

## Contract Upgrades

### Prerequisites

- Soroban CLI installed (`cargo install soroban-cli`)
- Stellar keypair with admin permissions
- Account funded on the target network

### Deploying a New Contract Version

```bash
# Build the WASM
cd contracts/escrow_contract
cargo build --release --target wasm32-unknown-unknown
cd -

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source <admin-keypair> \
  --network testnet

# Deploy to mainnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source <admin-keypair> \
  --network mainnet
```

### Upgrading an Existing Contract

```bash
soroban contract upgrade \
  --id <existing-contract-id> \
  --wasm target/wasm32-unknown-unknown/release/escrow_contract.wasm \
  --source <admin-keypair> \
  --network <network>
```

### Verifying the Upgrade

After upgrading, verify the contract is operational:

```bash
soroban contract call \
  --id <contract-id> \
  --source <admin-keypair> \
  --network <network> \
  -- get_admin
```

---

## Log Rotation and Disk Management

### Checking Disk Usage

```bash
df -h
docker system df
```

### Rotating Application Logs

The backend uses Winston or Pino for structured logging. Log rotation is handled by the log driver configuration in `docker-compose.yml` or by the host's logrotate daemon.

```bash
# Manual log rotation for Docker containers
docker compose exec backend truncate -s 0 logs/application.log
```

### Cleaning Up Old Docker Images

```bash
docker image prune -a --filter "until=720h"
```

---

## Certificate Renewal

If using Let's Encrypt with the reverse proxy:

```bash
# Check certificate expiry
openssl s_client -connect api.stellartrustescrow.com:443 -servername api.stellartrustescrow.com 2>/dev/null | openssl x509 -noout -dates

# Renew certificates
docker compose exec nginx certbot renew --dry-run
docker compose exec nginx certbot renew
docker compose restart nginx
```

---

## Scaling Operations

### Scaling the Backend

```bash
# Docker Compose
docker compose up -d --scale backend=3

# Kubernetes
kubectl scale deployment/trustchain-escrow-api --replicas=3
```

### Scaling Redis

```bash
# Redis Cluster requires manual sharding setup
# For simple vertical scaling, increase container resources
docker compose up -d --scale redis=1
```

### Scaling PostgreSQL

For read-heavy workloads, add read replicas:

```bash
# Create a read replica in your cloud provider
# Update DATABASE_URL_READ_REPLICA in the backend configuration
```

---

## Backup Verification

### Testing Database Backups

```bash
# Restore the latest backup to a temporary database
pg_restore --clean --if-exists --dbname=trustchain_backup_test latest.dump

# Verify row counts match production
psql $DATABASE_URL -c "SELECT count(*) FROM escrow;"
psql trustchain_backup_test -c "SELECT count(*) FROM escrow;"

# Drop the test database
dropdb trustchain_backup_test
```

### Testing File Backups (IPFS Evidence)

```bash
# Verify a sample evidence file is retrievable
curl -s https://ipfs.stellartrustescrow.com/ipfs/<sample-cid> | head -c 100
```

---

## Cross-References

- [Incident Response Guide](../incidents/README.md) — severity definitions and incident lifecycle
- [Production Deployment Guide](../production-deployment-guide.md) — deployment procedures
- [Monitoring Setup](../monitoring/setup.md) — metrics and alerting configuration
- [Disaster Recovery](../disaster-recovery.md) — backup and restore procedures
- [Configuration Reference](../configuration.md) — environment variables