const swaggerJsdoc = require('swagger-jsdoc');

/**
 * Webhook Delivery SLA & Reliability
 *
 * Expected delivery latency (normal operation):
 * - p50: < 500ms from event emission to first delivery attempt
 * - p95: < 2s
 * - p99: < 5s
 *
 * Delivery states:
 * - normal: endpoint healthy, deliveries succeed on the first attempt.
 * - degraded: elevated latency or intermittent failures; retries are in progress.
 *   The circuit breaker may be half-open while probing recovery.
 * - paused: circuit breaker is open after repeated failures; deliveries are
 *   suspended until the cooldown elapses and a probe succeeds.
 *
 * Retry backoff:
 * Failed deliveries are retried with exponential backoff and jitter.
 * Attempt 1: immediate
 * Attempt 2: ~30s
 * Attempt 3: ~2m
 * Attempt 4: ~10m
 * Attempt 5: ~1h (final attempt)
 * After the final attempt the delivery is marked as failed and surfaced via
 * the webhook status endpoint.
 *
 * Circuit breaker:
 * - closed: normal delivery; failures are counted.
 * - open: after the failure threshold is exceeded, deliveries are paused for
 *   the cooldown window.
 * - half-open: after cooldown, a limited number of probe deliveries are allowed;
 *   success closes the breaker, failure reopens it.
 *
 * Status inspection:
 * Use GET /api/webhooks/:id/status to inspect the current delivery state,
 * recent attempts, and the circuit breaker state for a webhook.
 */

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Webhook API',
      version: '1.0.0',
      description:
        'Webhook delivery API. See the module documentation for latency SLA, ' +
        'retry backoff, circuit breaker behavior, and status inspection.',
    },
    servers: [
      {
        url: '/api',
      },
    ],
  },
  apis: ['./backend/api/routes/*.js', './backend/api/controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
