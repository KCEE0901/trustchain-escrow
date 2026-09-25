/**
 * Tests — Webhook Delivery Status Query (Issue #203)
 *
 * Covers:
 *  - Successful delivery records are returned paginated
 *  - Failed delivery records are returned with errorMessage
 *  - Deliveries are scoped to the subscription owner (createdBy)
 *  - A caller who does not own the subscription gets an empty result
 *  - errorSummary totals are correct
 *  - Pagination metadata (totalPages, hasNextPage) is correct
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDeliveries = [
  {
    id: 'd1',
    eventType: 'esc_crt',
    status: 'success',
    attempts: 1,
    responseCode: 200,
    errorMessage: null,
    lastAttemptAt: new Date('2026-09-01T10:00:00Z'),
    createdAt: new Date('2026-09-01T09:59:00Z'),
  },
  {
    id: 'd2',
    eventType: 'funds_rel',
    status: 'failed',
    attempts: 5,
    responseCode: 503,
    errorMessage: 'Connection refused',
    lastAttemptAt: new Date('2026-09-01T11:00:00Z'),
    createdAt: new Date('2026-09-01T10:55:00Z'),
  },
];

const mockStatusCounts = [
  { status: 'success', _count: { id: 1 } },
  { status: 'failed', _count: { id: 1 } },
];

const prismaMock = {
  webhookSubscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  webhookDelivery: {
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

const queueMock = { enqueueWebhookDelivery: jest.fn() };

describe('Webhook Delivery Status Query (#203)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
    jest.unstable_mockModule('../queues/webhookQueue.js', () => ({
      enqueueWebhookDelivery: queueMock.enqueueWebhookDelivery,
    }));
    jest.unstable_mockModule('../lib/tenantContext.js', () => ({
      withTenantScopeBypassed: jest.fn((fn) => fn()),
    }));
  });

  // ── Happy path — successful deliveries ───────────────────────────────────────
  it('returns paginated successful deliveries for the subscription owner', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([mockDeliveries[0]]);
    prismaMock.webhookDelivery.count.mockResolvedValue(1);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue([mockStatusCounts[0]]);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
      page: 1,
      limit: 30,
    });

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].status).toBe('success');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.hasNextPage).toBe(false);
  });

  // ── Happy path — failed deliveries with errorMessage ─────────────────────────
  it('returns failed deliveries with errorMessage populated', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([mockDeliveries[1]]);
    prismaMock.webhookDelivery.count.mockResolvedValue(1);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue([mockStatusCounts[1]]);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
      page: 1,
      limit: 30,
    });

    expect(result.deliveries[0].status).toBe('failed');
    expect(result.deliveries[0].errorMessage).toBe('Connection refused');
    expect(result.errorSummary.total).toBe(1);
    expect(result.errorSummary.byStatus.failed).toBe(1);
  });

  // ── Tenant isolation — different owner gets empty result ─────────────────────
  it('returns empty deliveries when createdBy does not match subscription owner', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
    prismaMock.webhookDelivery.count.mockResolvedValue(0);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue([]);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOTHER_TENANT', // not the owner
      page: 1,
      limit: 30,
    });

    expect(result.deliveries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.errorSummary.total).toBe(0);

    // Verify the Prisma query included the createdBy filter
    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscription: expect.objectContaining({ createdBy: '0xOTHER_TENANT' }),
        }),
      }),
    );
  });

  // ── Pagination metadata ───────────────────────────────────────────────────────
  it('correctly computes pagination metadata across multiple pages', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue(mockDeliveries);
    prismaMock.webhookDelivery.count.mockResolvedValue(75);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue(mockStatusCounts);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
      page: 1,
      limit: 30,
    });

    expect(result.total).toBe(75);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(true);
  });

  it('sets hasNextPage=false on the last page', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue(mockDeliveries);
    prismaMock.webhookDelivery.count.mockResolvedValue(32);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue([]);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
      page: 2,
      limit: 30,
    });

    expect(result.hasNextPage).toBe(false);
    expect(result.totalPages).toBe(2);
  });

  // ── Error summary ─────────────────────────────────────────────────────────────
  it('returns a combined errorSummary across failed and error statuses', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([]);
    prismaMock.webhookDelivery.count.mockResolvedValue(0);
    prismaMock.webhookDelivery.groupBy.mockResolvedValue([
      { status: 'success', _count: { id: 10 } },
      { status: 'failed', _count: { id: 3 } },
      { status: 'error', _count: { id: 2 } },
    ]);

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
    });

    expect(result.errorSummary.total).toBe(5); // 3 failed + 2 error
    expect(result.errorSummary.byStatus.success).toBe(10);
    expect(result.errorSummary.byStatus.failed).toBe(3);
    expect(result.errorSummary.byStatus.error).toBe(2);
  });

  // ── groupBy unavailable (graceful degradation) ────────────────────────────────
  it('gracefully handles groupBy not being available', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([mockDeliveries[0]]);
    prismaMock.webhookDelivery.count.mockResolvedValue(1);
    prismaMock.webhookDelivery.groupBy.mockRejectedValue(new Error('groupBy not supported'));

    const { default: webhookService } = await import('../services/webhookService.js');
    const result = await webhookService.getDeliveryHistory({
      subscriptionId: 'sub_1',
      createdBy: '0xOWNER',
    });

    expect(result.deliveries).toHaveLength(1);
    expect(result.errorSummary.total).toBe(0);
    expect(result.errorSummary.byStatus).toEqual({});
  });
});
