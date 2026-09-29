/**
 * Swagger UI setup for the Stellar Trust Escrow API.
 *
 * Mounts:
 *   GET /api/docs       — Swagger UI (interactive)
 *   GET /api/docs/json  — Raw OpenAPI JSON spec
 *
 * Webhook delivery SLA
 * --------------------
 * Expected webhook delivery latency, retry backoff, circuit breaker
 * behavior, and status inspection are documented below and surfaced in the
 * OpenAPI spec via the `x-webhook-sla` extension so consumers can discover
 * the delivery guarantees programmatically.
 *
 * Delivery states
 *   - normal:   endpoint healthy; deliveries complete within the normal SLA.
 *   - degraded: elevated latency or intermittent failures; retries with
 *               exponential backoff are in progress.
 *   - paused:   circuit breaker is open; deliveries are queued and no new
 *               attempts are made until the breaker transitions to half-open.
 *
 * Latency SLA (normal state)
 *   - p50: < 1s from event emission to first delivery attempt.
 *   - p95: < 5s from event emission to first delivery attempt.
 *   - p99: < 15s from event emission to first delivery attempt.
 *   - Successful delivery (2xx response) is expected within 30s of emission.
 *
 * Retry backoff
 *   Failed deliveries (non-2xx or timeout) are retried with exponential
 *   backoff and jitter. The default schedule is:
 *     attempt 1: immediate
 *     attempt 2: ~5s
 *     attempt 3: ~30s
 *     attempt 4: ~2m
 *     attempt 5: ~10m
 *     attempt 6: ~1h (final attempt)
 *   A delivery is marked `failed` after the final attempt is exhausted.
 *
 * Circuit breaker
 *   - closed:    normal operation; deliveries are attempted immediately.
 *   - open:      after repeated failures the breaker opens and deliveries are
 *                paused (queued) for a cooldown window (~60s).
 *   - half-open: after the cooldown, a single probe delivery is attempted.
 *                Success closes the breaker; failure re-opens it.
 *
 * Status inspection
 *   Delivery status can be inspected per webhook via the webhook status
 *   endpoints (see the Webhooks tag in the OpenAPI spec). Each delivery
 *   reports its state (`pending`, `delivered`, `retrying`, `failed`),
 *   attempt count, last response status, and next scheduled retry time.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { swaggerOptions } from './swaggerConfig.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve api glob relative to the backend root (two levels up from this file)
const backendRoot = path.resolve(__dirname, '..', '..');

const resolvedOptions = {
  ...swaggerOptions,
  apis: [
    path.join(backendRoot, 'api', 'routes', '*.js'),
    path.join(backendRoot, 'api', 'docs', 'paths', '*.js'),
  ],
};

const swaggerSpec = swaggerJsdoc(resolvedOptions);

// Document the webhook delivery SLA in the generated OpenAPI spec so it is
// discoverable alongside the webhook endpoints.
swaggerSpec.info = swaggerSpec.info || {};
swaggerSpec.info['x-webhook-sla'] = {
  latency: {
    normal: {
      p50: '1s',
      p95: '5s',
      p99: '15s',
      successfulDelivery: '30s',
    },
    degraded: 'Elevated latency or intermittent failures; retries in progress.',
    paused: 'Circuit breaker open; deliveries queued until half-open probe.',
  },
  retryBackoff: {
    strategy: 'exponential-with-jitter',
    schedule: ['immediate', '5s', '30s', '2m', '10m', '1h'],
    maxAttempts: 6,
  },
  circuitBreaker: {
    states: ['closed', 'open', 'half-open'],
    openAfterFailures: 5,
    cooldown: '60s',
    halfOpenProbe: 'single delivery attempt',
  },
  statusInspection: {
    states: ['pending', 'delivered', 'retrying', 'failed'],
    fields: ['state', 'attempts', 'lastResponseStatus', 'nextRetryAt'],
  },
};

/**
 * Attach Swagger UI and JSON spec endpoints to an Express app.
 * @param {import('express').Application} app
 */
export function setupSwagger(app) {
  // Serve raw OpenAPI JSON spec
  app.get('/api/docs/json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Serve interactive Swagger UI
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Stellar Trust Escrow API Docs',
      customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    }),
  );

  console.log('[Swagger] API docs available at /api/docs');
}

export { swaggerSpec };
