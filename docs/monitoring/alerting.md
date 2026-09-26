# Alerting Rules & Configuration

## Grafana Provisioned Alerts

### High Dispute Rate (> 5%)

**Location**: `backend/monitoring/grafana/provisioning/alerting/rules/dispute-rate-alert.yml`

Fires when the ratio of disputed escrows to active escrows exceeds 5% over a 10-minute window.

```
Condition: count(disputed_escrows) / count(active_escrows) > 0.05
Duration: 10 minutes
Severity: WARNING
Notification: Via configured contact point (default: email)
```

**Why this matters**: A spike in dispute rate can indicate:
- Bad actors attempting fraud or abuse
- UX issues that frustrate users and lead to disputes
- Market friction or systemic problems in matching/delivery

**Response**: Investigate recent escrow cancellations, review dispute reasons, and check for patterns.

## Prometheus Alerting Rules

Create `backend/monitoring/rules.yml`:

```yaml
groups:
  - name: stellar-trust-escrow
    rules:
      # High Error Rate (>5% 5xx)
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: 'High error rate on {{ $labels.route }}'
          description: 'Error rate is {{ $value | humanizePercentage }}'

      # High Latency P95 >500ms
      - alert: HighLatencyP95
        expr: histogram_quantile(0.95, sum(rate(http_request_duration_ms_bucket[5m])) by (le)) > 500
        for: 1m
        labels: { severity: warning }
        annotations:
          summary: 'P95 latency high on {{ $labels.route }}'

      # DB Pool Exhaustion
      - alert: DBPoolExhausted
        expr: increase(db_connection_pool_exhaustion_total[1m]) > 0
        labels: { severity: critical }

      # Slow Queries Spike >10/min
      - alert: DBSlowQueriesSpike
        expr: increase(db_slow_queries_total[5m]) > 10
        labels: { severity: warning }

      # Low Cache Hit <80%
      - alert: LowCacheHitRate
        expr: sum(rate(cache_hits_total[5m])) / (sum(rate(cache_hits_total[5m])) + sum(rate(cache_misses_total[5m]))) < 0.8
        for: 5m
        labels: { severity: warning }

      # Event Loop Blocked >100ms
      - alert: EventLoopLag
        expr: nodejs_eventloop_lag_seconds > 0.1
        for: 30s
        labels: { severity: critical }

      # High DB Active Connections (>80% pool)
      - alert: HighDBConnections
        expr: db_connections_active > 50 # Adjust to pool size
        labels: { severity: warning }
```

**Enable in prometheus.yml**:

```yaml
rule_files:
  - 'rules.yml'
```

## Alertmanager Setup

`backend/monitoring/alertmanager.yml`:

```yaml
route:
  group_by: ['alertname']
  group_wait: 30s
  repeat_interval: 1h

receivers:
  - name: slack
    slack_configs:
      - api_url: '...'
        channel: '#alerts'
  - name: email
    email_configs:
      - to: 'ops@stellar-trust-escrow.com'

inhibit_rules: [...]
```

Docker Compose add:

```yaml
alertmanager:
  image: prom/alertmanager
  ports: ['9093:9093']
```

## Testing Alerts

1. `curl -X POST http://localhost:9090/-/reload`
2. Simulate: Chaos fault injection or load test
3. Check Grafana Alerting UI
