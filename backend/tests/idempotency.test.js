/**
 * Idempotency middleware tests — covers escrow, payment and webhook
 * subscription style routes using a minimal Express app.
 */

import express from 'express';
import request from 'supertest';
import { idempotencyMiddleware, _resetIdempotencyCache } from '../lib/idempotency.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  let counter = 0;
  const handler = (req, res) => res.status(201).json({ id: ++counter, body: req.body });

  const escrows = express.Router();
  escrows.post('/broadcast', idempotencyMiddleware, handler);
  const payments = express.Router();
  payments.post('/checkout', idempotencyMiddleware, handler);
  const webhooks = express.Router();
  webhooks.post('/subscribe', idempotencyMiddleware, handler);

  app.use('/api/escrows', escrows);
  app.use('/api/payments', payments);
  app.use('/api/webhooks', webhooks);
  app.post('/api/fail', idempotencyMiddleware, (req, res) =>
    res.status(500).json({ id: ++counter }),
  );
  return app;
};

const routes = ['/api/escrows/broadcast', '/api/payments/checkout', '/api/webhooks/subscribe'];

describe('idempotencyMiddleware', () => {
  let app;
  beforeEach(() => {
    _resetIdempotencyCache();
    app = buildApp();
  });

  it.each(routes)('replays the original result for repeated requests on %s', async (route) => {
    const payload = { amount: 100 };
    const first = await request(app).post(route).set('Idempotency-Key', 'k1').send(payload);
    const second = await request(app).post(route).set('Idempotency-Key', 'k1').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it.each(routes)('rejects a conflicting payload on %s', async (route) => {
    await request(app).post(route).set('Idempotency-Key', 'k2').send({ amount: 100 });
    const res = await request(app).post(route).set('Idempotency-Key', 'k2').send({ amount: 999 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('scopes keys per route', async () => {
    const a = await request(app).post(routes[0]).set('Idempotency-Key', 'k3').send({});
    const b = await request(app).post(routes[1]).set('Idempotency-Key', 'k3').send({});
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('does not cache requests without a key', async () => {
    const a = await request(app).post(routes[0]).send({});
    const b = await request(app).post(routes[0]).send({});
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('does not cache server errors', async () => {
    const a = await request(app).post('/api/fail').set('Idempotency-Key', 'k4').send({});
    const b = await request(app).post('/api/fail').set('Idempotency-Key', 'k4').send({});
    expect(b.body.id).not.toBe(a.body.id);
  });
});
