/**
 * Payment Service Tests
 *
 * Regression coverage for null/undefined handling in paymentService.js.
 * Motivating bug: `escrowId ? BigInt(escrowId) : null` used a truthy check,
 * so a valid escrowId of 0 was silently dropped and stored as null.
 *
 * @module tests/services/paymentService
 */

import { jest } from '@jest/globals';

const mockStripeCheckoutCreate = jest.fn();
const mockPaymentCreate = jest.fn();

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockStripeCheckoutCreate } },
  })),
}));

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  default: {
    payment: {
      create: mockPaymentCreate,
    },
  },
}));

jest.unstable_mockModule('../../lib/tenantContext.js', () => ({
  getCurrentTenantId: jest.fn(() => null),
  withTenantScopeBypassed: jest.fn((fn) => fn()),
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.FRONTEND_URL = 'https://example.test';

const { default: paymentService } = await import('../../services/paymentService.js');

describe('paymentService.createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStripeCheckoutCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });
    mockPaymentCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'pay_1', ...data }));
  });

  it('preserves escrowId 0 instead of treating it as absent', async () => {
    await paymentService.createCheckoutSession({
      address: 'GABC123',
      amountUsd: 10,
      escrowId: 0,
    });

    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ escrowId: 0n }),
      }),
    );

    const sessionArgs = mockStripeCheckoutCreate.mock.calls[0][0];
    expect(sessionArgs.metadata.escrowId).toBe('0');
  });

  it('stores null escrowId when omitted', async () => {
    await paymentService.createCheckoutSession({
      address: 'GABC123',
      amountUsd: 10,
    });

    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ escrowId: null }),
      }),
    );

    const sessionArgs = mockStripeCheckoutCreate.mock.calls[0][0];
    expect(sessionArgs.metadata.escrowId).toBe('');
  });
});
