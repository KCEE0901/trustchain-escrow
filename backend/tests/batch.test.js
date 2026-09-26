import { describe, it, expect, beforeEach } from '@jest/globals';
import supertest from 'supertest';
import express from 'express';

// ── Minimal Express app for testing ──────────────────────────────────────────
// We build a self-contained app so tests don't need a DB or Sentry.

function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Public route — always succeeds (prefixed under /api/escrows so it clears BATCH_ALLOWED_ROUTES)
  app.get('/api/escrows/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Public route — always 404 (prefixed under /api/escrows for same reason)
  app.get('/api/escrows/not-found', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Protected route — requires Authorization header
  app.get('/api/escrows/abc123', (req, res) => {
    if (!req.headers['authorization']) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    return res.status(200).json({ id: 'abc123', status: 'active' });
  });

  // Batch route (must come after the routes it will dispatch to)
  app.post('/api/batch', async (req, res) => {
    const { handleBatch } = await import('../api/controllers/batchController.js');
    return handleBatch(req, res);
  });

  return app;
}

describe('POST /api/batch', () => {
  let app;
  let request;

  beforeEach(() => {
    app = buildTestApp();
    request = supertest(app);
  });

  it('Test 1 (Mixed Results): returns correct status codes for each sub-request', async () => {
    const res = await request.post('/api/batch').send([
      { method: 'GET', url: '/api/escrows/health' },
      { method: 'GET', url: '/api/escrows/health' },
      { method: 'GET', url: '/api/escrows/not-found' },
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].status).toBe(200);
    expect(res.body[1].status).toBe(200);
    expect(res.body[2].status).toBe(404);
  });

  it('Test 2 (Auth Propagation): propagates parent Authorization header to protected sub-requests', async () => {
    const token = 'Bearer test-token-xyz';

    const res = await request
      .post('/api/batch')
      .set('Authorization', token)
      .send([{ method: 'GET', url: '/api/escrows/abc123' }]);

    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe(200);
    expect(res.body[0].data).toMatchObject({ id: 'abc123' });
  });

  it('Test 2b (Auth Propagation): returns 401 when no auth header is present on protected sub-request', async () => {
    const res = await request
      .post('/api/batch')
      .send([{ method: 'GET', url: '/api/escrows/abc123' }]);

    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe(401);
  });

  it('Test 3 (Limit Enforcement): returns 413 when batch exceeds MAX_BATCH_SIZE', async () => {
    const oversizedBatch = Array.from({ length: 21 }, () => ({
      method: 'GET',
      url: '/api/escrows/health',
    }));

    const res = await request.post('/api/batch').send(oversizedBatch);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/exceeds maximum/i);
  });

  it('returns 400 when body is not an array', async () => {
    const res = await request
      .post('/api/batch')
      .send({ method: 'GET', url: '/api/escrows/health' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it('Test 4 (#200 Partial-Failure Reporting): returns success, failure code, and reason for each item in mixed batch', async () => {
    const res = await request.post('/api/batch').send([
      { method: 'GET', url: '/api/escrows/health' },
      { method: 'GET', url: '/api/escrows/not-found' },
      { method: 'GET', url: '/api/escrows/abc123' }, // unauthorized
      { method: 'TRACE', url: '/api/escrows/health' }, // disallowed method
      { method: 'GET', url: '/admin/secret' }, // forbidden route
    ]);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);

    // Item 1: Successful GET
    expect(res.body[0].success).toBe(true);
    expect(res.body[0].failureCode).toBeNull();
    expect(res.body[0].reason).toBeNull();
    expect(res.body[0].status).toBe(200);

    // Item 2: 404 Not Found
    expect(res.body[1].success).toBe(false);
    expect(res.body[1].status).toBe(404);
    expect(res.body[1].failureCode).toBe('NOT_FOUND');
    expect(res.body[1].reason).toMatch(/not found/i);

    // Item 3: 401 Unauthorized
    expect(res.body[2].success).toBe(false);
    expect(res.body[2].status).toBe(401);
    expect(res.body[2].failureCode).toBe('UNAUTHORIZED');
    expect(res.body[2].reason).toMatch(/access denied/i);

    // Item 4: Method Not Allowed
    expect(res.body[3].success).toBe(false);
    expect(res.body[3].failureCode).toBe('METHOD_NOT_ALLOWED');
    expect(res.body[3].reason).toMatch(/method not allowed/i);

    // Item 5: Forbidden Route
    expect(res.body[4].success).toBe(false);
    expect(res.body[4].status).toBe(403);
    expect(res.body[4].failureCode).toBe('FORBIDDEN');
    expect(res.body[4].reason).toMatch(/route not permitted/i);
  });
});
