/**
 * Tests for the per-user rate limit applied to POST /webhooks/subscribe.
 *
 * Issue #366: Apply sliding-window rate limiter at 10 req/min per user ID.
 * Verifies:
 *   - Requests 1–10 succeed (200)
 *   - Request 11 returns 429 with Retry-After header
 *   - Rate limit key is scoped to user ID, not global
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock dependencies consumed transitively by webhookRoutes / webhookController
const prismaMock = {
  webhookSubscription: {
    create: jest.fn().mockResolvedValue({
      id: 'sub_1',
      url: 'https://example.com/hook',
      eventTypes: ['esc_crt'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  webhookDelivery: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../queues/webhookQueue.js', () => ({
  enqueueWebhookDelivery: jest.fn(),
}));

// Import the rate limiter store so we can clear state between tests
const { getUsageStore } = await import('../api/middleware/rateLimiter.js');
const { default: webhookRoutes } = await import('../api/routes/webhookRoutes.js');

/**
 * Build a minimal Express app that mounts webhook routes with a pre-set user.
 */
function buildApp(userId = 'user-abc') {
  const app = express();
  app.use(express.json());
  // Inject authenticated user — mirrors what authMiddleware does in production
  app.use((req, _res, next) => {
    req.user = { id: userId, address: `GABC${userId}` };
    next();
  });
  app.use('/webhooks', webhookRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Clear in-memory sliding window state between test cases
  getUsageStore().clear();
});

describe('POST /webhooks/subscribe — per-user rate limit (issue #366)', () => {
  const payload = {
    url: 'https://example.com/hook',
    eventTypes: ['esc_crt'],
  };

  it('allows the first 10 requests within one minute', async () => {
    const app = buildApp('user-rate-limit-test');
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/webhooks/subscribe').send(payload);
      expect(res.status).not.toBe(429);
    }
  });

  it('returns 429 on the 11th request within one minute', async () => {
    const app = buildApp('user-rate-limit-11');
    for (let i = 0; i < 10; i++) {
      await request(app).post('/webhooks/subscribe').send(payload);
    }
    const res = await request(app).post('/webhooks/subscribe').send(payload);
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header in the 429 response', async () => {
    const app = buildApp('user-retry-after');
    for (let i = 0; i < 10; i++) {
      await request(app).post('/webhooks/subscribe').send(payload);
    }
    const res = await request(app).post('/webhooks/subscribe').send(payload);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rate limit is per-user — different users have independent counters', async () => {
    const appA = buildApp('user-alpha');
    const appB = buildApp('user-beta');

    // Exhaust user-alpha's limit
    for (let i = 0; i < 10; i++) {
      await request(appA).post('/webhooks/subscribe').send(payload);
    }
    const resA = await request(appA).post('/webhooks/subscribe').send(payload);
    expect(resA.status).toBe(429);

    // user-beta should still be allowed
    const resB = await request(appB).post('/webhooks/subscribe').send(payload);
    expect(resB.status).not.toBe(429);
  });
});
