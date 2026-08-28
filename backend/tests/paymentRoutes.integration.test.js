/**
 * Integration tests — paymentRoutes.js happy-path flow
 *
 * Exercises the full request pipeline through the Express router, auth
 * middleware, validation, and authorization layers, using mocked service
 * dependencies so no database or Stripe connection is needed.
 *
 * Endpoints covered:
 *   POST   /api/payments/webhook
 *   POST   /api/payments/checkout
 *   GET    /api/payments/status/:sessionId
 *   GET    /api/payments/:address
 *   POST   /api/payments/:paymentId/refund
 */

import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

// ── Constants ─────────────────────────────────────────────────────────────────

// Valid 56-char Stellar G-addresses (base-32 alphabet A-Z2-7)
const WALLET_ADDRESS = `G${'A'.repeat(55)}`;
const OTHER_ADDRESS = `G${'B'.repeat(55)}`;

const SESSION_ID = 'cs_test_session_001';
const PAYMENT_ID = 'pay_test_001';
const STRIPE_PAYLOAD = JSON.stringify({ type: 'checkout.session.completed' });

// ── Service mocks ─────────────────────────────────────────────────────────────

const paymentServiceMock = {
  createCheckoutSession: jest.fn(),
  getBySessionId: jest.fn(),
  getByAddress: jest.fn(),
  getById: jest.fn(),
  refund: jest.fn(),
  handleWebhook: jest.fn(),
};

const kycServiceMock = {
  getStatus: jest.fn(),
};

const sessionServiceMock = {
  isSessionValid: jest.fn(),
};

// Metrics stub — needed because paymentRoutes → auth → (metrics referenced
// indirectly via app bootstrap).  Provide the full shape expected by lib/metrics.
const metricStub = () => ({
  inc: jest.fn(),
  observe: jest.fn(),
  set: jest.fn(),
  dec: jest.fn(),
});

jest.unstable_mockModule('../services/paymentService.js', () => ({
  default: paymentServiceMock,
}));

jest.unstable_mockModule('../services/kycService.js', () => ({
  default: kycServiceMock,
}));

jest.unstable_mockModule('../services/sessionService.js', () => ({
  default: sessionServiceMock,
}));

jest.unstable_mockModule('../lib/metrics.js', () => ({
  register: { metrics: jest.fn(async () => '') },
  httpRequestDuration: metricStub(),
  httpRequestTotal: metricStub(),
  httpRequestsInFlight: metricStub(),
  dbQueryDuration: metricStub(),
  dbQueryTotal: metricStub(),
  dbSlowQueryTotal: metricStub(),
  dbConnectionsTotal: metricStub(),
  dbConnectionsActive: metricStub(),
  dbConnectionsIdle: metricStub(),
  dbConnectionErrorsTotal: metricStub(),
  dbConnectionPoolExhaustionTotal: metricStub(),
  cacheHitsTotal: metricStub(),
  cacheMissesTotal: metricStub(),
  cacheSize: metricStub(),
  escrowsCreatedTotal: metricStub(),
  disputesRaisedTotal: metricStub(),
  milestonesCompletedTotal: metricStub(),
  activeEscrowsGauge: metricStub(),
  circuitBreakerState: metricStub(),
  circuitBreakerCallsTotal: metricStub(),
  circuitBreakerTransitionsTotal: metricStub(),
  chaosInjectedTotal: metricStub(),
  errorsTotal: metricStub(),
  compressedResponsesTotal: metricStub(),
  compressionBytesTotal: metricStub(),
  compressionRatio: metricStub(),
}));

// ── Dynamic import (after mocks are registered) ───────────────────────────────

const { default: paymentRoutes } = await import('../api/routes/paymentRoutes.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a signed JWT for WALLET_ADDRESS using the same secret that
 * config/secrets.js vends in test mode (it auto-generates and caches
 * process.env.JWT_SECRET when NODE_ENV === 'test').
 */
function bearerToken(address = WALLET_ADDRESS) {
  return `Bearer ${jwt.sign(
    { userId: 1, tenantId: 'tenant_default', address },
    process.env.JWT_SECRET,
  )}`;
}

function createApp() {
  const app = express();
  // express.json() must be mounted globally so that POST /checkout and other
  // JSON endpoints can parse their bodies.  The /webhook route uses its own
  // captureRawBody + express.json() pair defined inside paymentRoutes, so
  // mounting a global parser here does not affect raw-body capture.
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // By default every session is valid; override per-test when needed.
  sessionServiceMock.isSessionValid.mockResolvedValue(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/payments/webhook — happy path', () => {
  it('processes a Stripe webhook event and returns { ok: true }', async () => {
    paymentServiceMock.handleWebhook.mockResolvedValue({ id: PAYMENT_ID, status: 'Completed' });

    const app = createApp();
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('stripe-signature', 'v1=test_sig')
      .set('content-type', 'text/plain')
      .send(STRIPE_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(paymentServiceMock.handleWebhook).toHaveBeenCalledWith(STRIPE_PAYLOAD, 'v1=test_sig');
  });
});

describe('POST /api/payments/checkout — happy path', () => {
  it('creates a checkout session for a KYC-approved wallet and returns session details', async () => {
    kycServiceMock.getStatus.mockResolvedValue({ status: 'Approved' });
    paymentServiceMock.createCheckoutSession.mockResolvedValue({
      sessionId: SESSION_ID,
      url: 'https://checkout.stripe.com/pay/test',
      paymentId: PAYMENT_ID,
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/payments/checkout')
      .set('Authorization', bearerToken())
      .send({ address: WALLET_ADDRESS, amountUsd: 50 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: SESSION_ID,
      url: expect.stringContaining('stripe.com'),
      paymentId: PAYMENT_ID,
    });
    expect(kycServiceMock.getStatus).toHaveBeenCalledWith(WALLET_ADDRESS);
    expect(paymentServiceMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ address: WALLET_ADDRESS, amountUsd: 50 }),
    );
  });

  it('includes an optional escrowId when supplied by the caller', async () => {
    kycServiceMock.getStatus.mockResolvedValue({ status: 'Approved' });
    paymentServiceMock.createCheckoutSession.mockResolvedValue({
      sessionId: SESSION_ID,
      url: 'https://checkout.stripe.com/pay/test',
      paymentId: PAYMENT_ID,
    });

    const app = createApp();
    await request(app)
      .post('/api/payments/checkout')
      .set('Authorization', bearerToken())
      .send({ address: WALLET_ADDRESS, amountUsd: 100, escrowId: '42' })
      .expect(200);

    expect(paymentServiceMock.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ escrowId: '42' }),
    );
  });
});

describe('GET /api/payments/status/:sessionId — happy path', () => {
  it('returns payment details for a session owned by the authenticated wallet', async () => {
    const paymentRecord = {
      id: PAYMENT_ID,
      address: WALLET_ADDRESS,
      status: 'Completed',
      amountFiat: 5000,
      createdAt: new Date().toISOString(),
    };
    paymentServiceMock.getBySessionId.mockResolvedValue(paymentRecord);

    const app = createApp();
    const res = await request(app)
      .get(`/api/payments/status/${SESSION_ID}`)
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: PAYMENT_ID, status: 'Completed' });
    expect(paymentServiceMock.getBySessionId).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('GET /api/payments/:address — happy path', () => {
  it('returns the payment list for the authenticated wallet address', async () => {
    const payments = [
      {
        id: PAYMENT_ID,
        amountFiat: 5000,
        status: 'Completed',
        createdAt: new Date().toISOString(),
      },
    ];
    paymentServiceMock.getByAddress.mockResolvedValue(payments);

    const app = createApp();
    const res = await request(app)
      .get(`/api/payments/${WALLET_ADDRESS}`)
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: PAYMENT_ID, status: 'Completed' });
    expect(paymentServiceMock.getByAddress).toHaveBeenCalledWith(WALLET_ADDRESS);
  });

  it('returns an empty array when no payments exist for the address', async () => {
    paymentServiceMock.getByAddress.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app)
      .get(`/api/payments/${WALLET_ADDRESS}`)
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/payments/:paymentId/refund — happy path', () => {
  it('issues a refund for a completed payment owned by the authenticated wallet', async () => {
    paymentServiceMock.getById.mockResolvedValue({
      id: PAYMENT_ID,
      address: WALLET_ADDRESS,
      status: 'Completed',
    });
    paymentServiceMock.refund.mockResolvedValue({
      id: PAYMENT_ID,
      address: WALLET_ADDRESS,
      status: 'Refunded',
      refundId: 're_test_001',
    });

    const app = createApp();
    const res = await request(app)
      .post(`/api/payments/${PAYMENT_ID}/refund`)
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: PAYMENT_ID, status: 'Refunded' });
    expect(paymentServiceMock.getById).toHaveBeenCalledWith(PAYMENT_ID);
    expect(paymentServiceMock.refund).toHaveBeenCalledWith(PAYMENT_ID);
  });
});

// ── Auth guard sanity checks (ensure the pipeline rejects unauthenticated calls) ─

describe('Auth guard — protected endpoints reject unauthenticated requests', () => {
  it.each([
    ['POST', '/api/payments/checkout', { address: WALLET_ADDRESS, amountUsd: 10 }],
    ['GET', `/api/payments/status/${SESSION_ID}`, null],
    ['GET', `/api/payments/${WALLET_ADDRESS}`, null],
    ['POST', `/api/payments/${PAYMENT_ID}/refund`, null],
  ])('%s %s returns 401 without a token', async (method, path, body) => {
    const app = createApp();
    let req = request(app)[method.toLowerCase()](path);
    if (body) req = req.send(body);
    const res = await req;
    expect(res.status).toBe(401);
  });
});
