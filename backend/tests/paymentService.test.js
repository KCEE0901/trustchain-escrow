/**
 * Integration tests for paymentService.js — issue #226
 *
 * Exercises the full happy-path flow:
 *   1. createCheckoutSession  — creates a Stripe session and persists to DB
 *   2. getBySessionId         — retrieves payment by Stripe session ID
 *   3. getById                — retrieves payment by internal ID
 *   4. getByAddress           — lists payments for a Stellar address
 *   5. refund                 — issues a full Stripe refund
 *   6. handleWebhook          — processes checkout.session.completed
 *                               and checkout.session.expired events
 */

import { jest } from '@jest/globals';

// ── Prisma mock ────────────────────────────────────────────────────────────────
const prismaMock = {
  payment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

// ── tenantContext mock ─────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/tenantContext.js', () => ({
  getCurrentTenantId: jest.fn().mockReturnValue(null),
  withTenantScopeBypassed: jest.fn(async (fn) => fn()),
}));

// ── Stripe mock ────────────────────────────────────────────────────────────────
const mockSession = {
  id: 'cs_test_session123',
  url: 'https://checkout.stripe.com/pay/cs_test_session123',
  payment_intent: 'pi_test_123',
  amount_total: 5000, // $50.00
  object: 'checkout.session',
  metadata: { address: 'GSTELLAR123', escrowId: '42', tenantId: '' },
};

const mockStripe = {
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue(mockSession) },
  },
  refunds: { create: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => mockStripe),
}));

// ── fetch mock (Horizon XLM price) ────────────────────────────────────────────
const fetchMock = jest.fn();
global.fetch = fetchMock;

// ── env ───────────────────────────────────────────────────────────────────────
process.env.STRIPE_SECRET_KEY = 'sk_test_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const paymentService = (await import('../services/paymentService.js')).default;

const ADDRESS = 'GSTELLAR123';
const PAYMENT_ID = 'payment_001';
const SESSION_ID = 'cs_test_session123';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('paymentService — happy-path flow', () => {
  it('createCheckoutSession creates a Stripe session and persists payment record', async () => {
    prismaMock.payment.create.mockResolvedValueOnce({
      id: PAYMENT_ID,
      address: ADDRESS,
      stripeSessionId: SESSION_ID,
      amountFiat: 5000,
      status: 'Pending',
    });

    const result = await paymentService.createCheckoutSession({
      address: ADDRESS,
      amountUsd: 50,
      escrowId: '42',
    });

    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.url).toContain('checkout.stripe.com');
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method_types: ['card'],
        mode: 'payment',
        metadata: expect.objectContaining({ address: ADDRESS }),
      }),
    );
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ address: ADDRESS, status: 'Pending' }),
      }),
    );
  });

  it('getBySessionId returns the payment record', async () => {
    const record = {
      id: PAYMENT_ID,
      address: ADDRESS,
      stripeSessionId: SESSION_ID,
      amountFiat: 5000,
      status: 'Pending',
    };
    prismaMock.payment.findUnique.mockResolvedValueOnce(record);

    const result = await paymentService.getBySessionId(SESSION_ID);

    expect(result.id).toBe(PAYMENT_ID);
    expect(prismaMock.payment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSessionId: SESSION_ID } }),
    );
  });

  it('getById returns the payment record with status fields', async () => {
    const record = {
      id: PAYMENT_ID,
      address: ADDRESS,
      status: 'Completed',
      stripePaymentIntent: 'pi_test_123',
      refundId: null,
    };
    prismaMock.payment.findUnique.mockResolvedValueOnce(record);

    const result = await paymentService.getById(PAYMENT_ID);

    expect(result.status).toBe('Completed');
    expect(result.stripePaymentIntent).toBe('pi_test_123');
  });

  it('getByAddress returns paginated payments for a Stellar address', async () => {
    const payments = [
      { id: 'p1', address: ADDRESS, amountFiat: 5000, status: 'Completed' },
      { id: 'p2', address: ADDRESS, amountFiat: 2000, status: 'Pending' },
    ];
    prismaMock.payment.findMany.mockResolvedValueOnce(payments);

    const result = await paymentService.getByAddress(ADDRESS);

    expect(result).toHaveLength(2);
    expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { address: ADDRESS } }),
    );
  });

  it('refund issues a Stripe refund and updates payment to Refunded', async () => {
    prismaMock.payment.findUniqueOrThrow.mockResolvedValueOnce({
      id: PAYMENT_ID,
      status: 'Completed',
      stripePaymentIntent: 'pi_test_123',
    });
    mockStripe.refunds.create.mockResolvedValueOnce({ id: 're_test_refund123' });
    prismaMock.payment.update.mockResolvedValueOnce({
      id: PAYMENT_ID,
      status: 'Refunded',
      refundId: 're_test_refund123',
    });

    const result = await paymentService.refund(PAYMENT_ID);

    expect(result.status).toBe('Refunded');
    expect(result.refundId).toBe('re_test_refund123');
    expect(mockStripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test_123' }),
    );
  });

  it('refund throws when payment is not in Completed status', async () => {
    prismaMock.payment.findUniqueOrThrow.mockResolvedValueOnce({
      id: PAYMENT_ID,
      status: 'Pending',
      stripePaymentIntent: null,
    });

    await expect(paymentService.refund(PAYMENT_ID)).rejects.toThrow(
      'Cannot refund payment in status: Pending',
    );
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it('handleWebhook checkout.session.completed updates payment to Completed', async () => {
    // Mock Horizon price fetch
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bids: [{ price: '0.10' }] }),
    });

    const event = {
      type: 'checkout.session.completed',
      data: { object: { ...mockSession } },
    };
    mockStripe.webhooks.constructEvent.mockReturnValueOnce(event);

    const completedPayment = {
      id: PAYMENT_ID,
      address: ADDRESS,
      status: 'Completed',
      stripePaymentIntent: 'pi_test_123',
    };
    prismaMock.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.payment.findFirst.mockResolvedValueOnce(completedPayment);

    const result = await paymentService.handleWebhook('rawBody', 'sig_test');

    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Completed' }),
      }),
    );
    expect(result.status).toBe('Completed');
  });

  it('handleWebhook checkout.session.expired updates payment to Failed', async () => {
    const expiredSession = {
      ...mockSession,
      object: 'checkout.session',
      metadata: { tenantId: '' },
    };
    const event = {
      type: 'checkout.session.expired',
      data: { object: expiredSession },
    };
    mockStripe.webhooks.constructEvent.mockReturnValueOnce(event);
    prismaMock.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    await paymentService.handleWebhook('rawBody', 'sig_test');

    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Failed' } }),
    );
  });

  it('handleWebhook returns null for unhandled event types', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValueOnce({
      type: 'customer.created',
      data: { object: {} },
    });

    const result = await paymentService.handleWebhook('rawBody', 'sig_test');
    expect(result).toBeNull();
  });
});
