import { jest } from '@jest/globals';

const prismaMock = {
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
  escrow: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
};
const webhookServiceMock = {
  getDeliveryHistory: jest.fn(async ({ page, limit }) => ({
    page,
    limit,
    total: 0,
    deliveries: [],
  })),
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../config/logger.js', () => ({ logControllerError: jest.fn() }));
jest.unstable_mockModule('../services/expiryService.js', () => ({
  processExpiredEscrows: jest.fn(),
  getExpiryStatus: jest.fn(),
  findExpiredEscrows: jest.fn(),
}));
jest.unstable_mockModule('../services/webhookService.js', () => ({ default: webhookServiceMock }));

const { default: expiryController } = await import('../api/controllers/expiryController.js');
const { default: webhookController } = await import('../api/controllers/webhookController.js');
const { paginationDocs } = await import('../lib/pagination.js');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('pagination limit enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('caps excessive limits on expiry pending list and reports the effective limit', async () => {
    const res = createRes();
    await expiryController.listPendingExpirations({ query: { limit: '5000' } }, res);

    expect(res.body.limit).toBe(paginationDocs.maxLimit);
    expect(prismaMock.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: paginationDocs.maxLimit }),
    );
  });

  it('falls back to the default limit for invalid expiry limits', async () => {
    const res = createRes();
    await expiryController.listPendingExpirations({ query: { limit: 'abc' } }, res);

    expect(res.body.limit).toBe(paginationDocs.defaultLimit);
  });

  it('caps excessive limits on webhook deliveries and reports the effective limit', async () => {
    const res = createRes();
    await webhookController.getDeliveries(
      { params: { id: 'sub_1' }, query: { limit: '9999' } },
      res,
    );

    expect(webhookServiceMock.getDeliveryHistory).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: paginationDocs.maxLimit }),
    );
    expect(res.body.limit).toBe(paginationDocs.maxLimit);
  });

  it('keeps the webhook deliveries default limit and ignores invalid values', async () => {
    const res = createRes();
    await webhookController.getDeliveries(
      { params: { id: 'sub_1' }, query: { limit: 'abc' } },
      res,
    );

    expect(res.body.limit).toBe(paginationDocs.defaultLimit);

    await webhookController.getDeliveries({ params: { id: 'sub_1' }, query: {} }, res);
    expect(res.body.limit).toBe(30);
  });
});
