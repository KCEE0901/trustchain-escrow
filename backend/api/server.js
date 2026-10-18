'use strict';

const express = require('express');
const crypto = require('crypto');

const app = express();

// ---------------------------------------------------------------------------
// Structured telemetry for middleware ordering.
// Bounded metric names/labels, deterministic logs, no sensitive values.
// ---------------------------------------------------------------------------

const METRIC_PREFIX = 'api.middleware';
const MAX_LABEL_LENGTH = 64;
const ALLOWED_STAGES = new Set(['request', 'response', 'error']);

const metrics = {
  counters: Object.create(null),
};

function sanitizeLabel(value) {
  if (value === undefined || value === null) {
    return 'unknown';
  }
  const str = String(value);
  // Keep only safe characters and bound the length to avoid unbounded cardinality.
  const cleaned = str.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, MAX_LABEL_LENGTH);
  return cleaned.length > 0 ? cleaned : 'unknown';
}

function metricKey(name, labels) {
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${sanitizeLabel(labels[k])}`);
  return parts.length > 0 ? `${name}{${parts.join(',')}}` : name;
}

function incrementCounter(name, labels = {}) {
  const key = metricKey(`${METRIC_PREFIX}.${name}`, labels);
  metrics.counters[key] = (metrics.counters[key] || 0) + 1;
}

function getMetricsSnapshot() {
  return { counters: { ...metrics.counters } };
}

function logEvent(level, event, fields = {}) {
  const entry = {
    level,
    event,
    ts: new Date().toISOString(),
  };
  for (const key of Object.keys(fields).sort()) {
    entry[key] = fields[key];
  }
  // Deterministic, secret-free structured log line.
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

// Correlation id: reuse inbound header when present, otherwise generate one.
// Never echo arbitrary client values into logs beyond a bounded, sanitized id.
function correlationMiddleware(req, res, next) {
  const inbound = req.get('x-request-id');
  const requestId = inbound ? sanitizeLabel(inbound) : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

// Ordering telemetry: records which middleware stage ran and its outcome.
function telemetryMiddleware(stage) {
  if (!ALLOWED_STAGES.has(stage)) {
    throw new Error(`invalid telemetry stage: ${stage}`);
  }
  return function telemetry(req, res, next) {
    const startedAt = process.hrtime.bigint();
    incrementCounter('stage_total', { stage, outcome: 'entered' });

    let finished = false;
    const finish = (outcome) => {
      if (finished) {
        return;
      }
      finished = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      incrementCounter('stage_total', { stage, outcome });
      logEvent('info', 'middleware.stage', {
        requestId: req.requestId || 'unknown',
        stage,
        outcome,
        durationMs: Math.round(durationMs * 1000) / 1000,
        status: res.statusCode,
      });
    };

    res.on('finish', () => finish('completed'));
    res.on('close', () => finish(res.writableFinished ? 'completed' : 'aborted'));

    try {
      next();
    } catch (err) {
      finish('error');
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Middleware ordering (production).
// ---------------------------------------------------------------------------

app.use(correlationMiddleware);
app.use(telemetryMiddleware('request'));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', (req, res) => {
  res.status(200).json(getMetricsSnapshot());
});

// Response-stage telemetry runs after handlers, before error handling.
app.use(telemetryMiddleware('response'));

// Error handler: bounded, secret-free error telemetry.
app.use((err, req, res, next) => {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  incrementCounter('error_total', { status: String(status) });
  logEvent('error', 'middleware.error', {
    requestId: req.requestId || 'unknown',
    status,
    // Only the error name/type is logged; messages may contain sensitive data.
    errorType: sanitizeLabel(err && err.name ? err.name : 'Error'),
  });
  if (res.headersSent) {
    return next(err);
  }
  res.status(status).json({ error: status >= 500 ? 'internal_error' : 'request_error' });
});

module.exports = app;
