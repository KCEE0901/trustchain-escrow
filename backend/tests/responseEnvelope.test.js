/**
 * Response Envelope Compatibility Tests
 *
 * Locks the top-level shape of /api/v1 responses:
 *   - success           → { data, meta: { requestId, timestamp, version } }
 *   - validation error  → { error: { code, message, ...extras } }
 *   - auth error        → { error: { code, message } }
 *   - paginated list    → { data, meta: { ..., pagination } }
 *   - health / streaming endpoints bypass the envelope
 */

import express from 'express';
import { responseEnvelope } from '../api/middleware/responseEnvelope.js';

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();

  // Health endpoints are mounted outside the v1 router, as in server.js.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  const v1 = express.Router();
  v1.use(responseEnvelope);
  v1.get('/item', (_req, res) => res.json({ id: 1, name: 'escrow' }));
  v1.get('/wrapped', (_req, res) => res.json({ data: { id: 2 } }));
  v1.post('/validate', (_req, res) =>
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'txHash is required', field: 'txHash' },
    }),
  );
  v1.get('/auth', (_req, res) => res.status(401).json({ error: 'Unauthorized' }));
  v1.get('/boom', (_req, res) => res.status(500).json({ message: 'db down' }));
  v1.get('/list', (_req, res) =>
    res.json({
      data: [{ id: 1 }, { id: 2 }],
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    }),
  );
  v1.get('/array', (_req, res) => res.json([1, 2, 3]));
  v1.get('/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: {"tick":1}\n\n');
    res.end();
  });
  app.use('/api/v1', v1);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (path, init) => fetch(`${baseUrl}${path}`, init);

describe('responseEnvelope', () => {
  it('wraps a plain success body in { data, meta }', async () => {
    const res = await get('/api/v1/item', { headers: { 'x-request-id': 'req-123' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body.data).toEqual({ id: 1, name: 'escrow' });
    expect(body.meta).toEqual({
      requestId: 'req-123',
      timestamp: expect.any(String),
      version: expect.any(String),
    });
  });

  it('unwraps an existing data key instead of double-nesting', async () => {
    const body = await (await get('/api/v1/wrapped')).json();

    expect(body.data).toEqual({ id: 2 });
    expect(body.meta.requestId).toBeNull();
  });

  it('shapes validation errors as { error: { code, message, ...extras } }', async () => {
    const res = await get('/api/v1/validate', { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'txHash is required',
      field: 'txHash',
    });
  });

  it('normalises string auth errors into { error: { code, message } }', async () => {
    const res = await get('/api/v1/auth');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: { code: 'REQUEST_ERROR', message: 'Unauthorized' } });
  });

  it('treats 5xx bodies without an error key as errors', async () => {
    const res = await get('/api/v1/boom');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'db down' } });
  });

  it('keeps paginated lists as { data, meta } with pagination preserved', async () => {
    const body = await (await get('/api/v1/list')).json();

    expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
    expect(body.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(body.meta.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('leaves top-level arrays untouched', async () => {
    expect(await (await get('/api/v1/array')).json()).toEqual([1, 2, 3]);
  });

  it('does not touch streaming responses', async () => {
    const res = await get('/api/v1/stream');

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe('data: {"tick":1}\n\n');
  });

  it('does not wrap health endpoints mounted outside the v1 router', async () => {
    expect(await (await get('/health')).json()).toEqual({ status: 'ok' });
  });
});
