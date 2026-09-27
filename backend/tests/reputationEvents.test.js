import { jest } from '@jest/globals';

/**
 * Covers #455: GET /api/v1/users/:address/reputation/events
 *   - reputationService.fetchEvents  (Prisma query + type-name mapping)
 *   - reputationController.getReputationEvents (validation + pagination response)
 */
const prismaMock = {
  reputationEvent: { findMany: jest.fn(), count: jest.fn() },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: prismaMock,
}));

const { fetchEvents } = await import('../services/reputationService.js');
const { default: reputationController } = await import(
  '../api/controllers/reputationController.js'
);

const VALID_ADDRESS = 'G' + 'A'.repeat(55);

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reputationService.fetchEvents', () => {
  it('maps internal eventType values to the public type names', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([
      {
        eventType: 'ESCROW_COMPLETED',
        escrowId: 1n,
        scoreDelta: 10,
        createdAt: new Date('2024-01-03T00:00:00Z'),
      },
      {
        eventType: 'DISPUTE_WON',
        escrowId: 2n,
        scoreDelta: 15,
        createdAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        eventType: 'DISPUTE_LOST',
        escrowId: 3n,
        scoreDelta: -5,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ]);
    prismaMock.reputationEvent.count.mockResolvedValue(3);

    const { events, total } = await fetchEvents(VALID_ADDRESS, { limit: 20, skip: 0 });

    expect(total).toBe(3);
    expect(events).toEqual([
      { type: 'COMPLETION', escrowId: '1', timestamp: new Date('2024-01-03T00:00:00Z'), scoreDelta: 10 },
      { type: 'DISPUTE_WIN', escrowId: '2', timestamp: new Date('2024-01-02T00:00:00Z'), scoreDelta: 15 },
      { type: 'DISPUTE_LOSS', escrowId: '3', timestamp: new Date('2024-01-01T00:00:00Z'), scoreDelta: -5 },
    ]);
  });

  it('excludes CANCELLATION events from the query', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    await fetchEvents(VALID_ADDRESS, { limit: 20, skip: 0 });

    const call = prismaMock.reputationEvent.findMany.mock.calls[0][0];
    expect(call.where.eventType.in).not.toContain('CANCELLATION');
    expect(call.where.eventType.in.sort()).toEqual(
      ['DISPUTE_LOST', 'DISPUTE_WON', 'ESCROW_COMPLETED'].sort(),
    );
  });

  it('orders by createdAt descending (newest first)', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    await fetchEvents(VALID_ADDRESS, { limit: 20, skip: 0 });

    const call = prismaMock.reputationEvent.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('applies the given limit and skip for pagination', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    await fetchEvents(VALID_ADDRESS, { limit: 5, skip: 10 });

    const call = prismaMock.reputationEvent.findMany.mock.calls[0][0];
    expect(call.take).toBe(5);
    expect(call.skip).toBe(10);
  });

  it('defaults to limit 20 and skip 0 when no options are given', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    await fetchEvents(VALID_ADDRESS);

    const call = prismaMock.reputationEvent.findMany.mock.calls[0][0];
    expect(call.take).toBe(20);
    expect(call.skip).toBe(0);
  });

  it('returns an empty list and zero total for an address with no events', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    const { events, total } = await fetchEvents(VALID_ADDRESS);

    expect(events).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('reputationController.getReputationEvents', () => {
  it('rejects an invalid Stellar address with 400', async () => {
    const req = { params: { address: 'not-a-valid-address' }, query: {} };
    const res = mockRes();

    await reputationController.getReputationEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(prismaMock.reputationEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns a paginated response with the completion event for a known address', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([
      {
        eventType: 'ESCROW_COMPLETED',
        escrowId: 42n,
        scoreDelta: 10,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ]);
    prismaMock.reputationEvent.count.mockResolvedValue(1);

    const req = { params: { address: VALID_ADDRESS }, query: {} };
    const res = mockRes();

    await reputationController.getReputationEvents(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual([
      expect.objectContaining({ type: 'COMPLETION', escrowId: '42', scoreDelta: 10 }),
    ]);
    expect(payload.total).toBe(1);
  });

  it('defaults to a limit of 20 when no limit query param is given', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    const req = { params: { address: VALID_ADDRESS }, query: {} };
    const res = mockRes();

    await reputationController.getReputationEvents(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.limit).toBe(20);
  });

  it('respects a custom limit query param', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(0);

    const req = { params: { address: VALID_ADDRESS }, query: { limit: '5' } };
    const res = mockRes();

    await reputationController.getReputationEvents(req, res);

    expect(prismaMock.reputationEvent.findMany.mock.calls[0][0].take).toBe(5);
    expect(res.json.mock.calls[0][0].limit).toBe(5);
  });

  it('advances through pages using the returned nextCursor', async () => {
    prismaMock.reputationEvent.findMany.mockResolvedValue([]);
    prismaMock.reputationEvent.count.mockResolvedValue(50);

    const firstReq = { params: { address: VALID_ADDRESS }, query: { limit: '20' } };
    const firstRes = mockRes();
    await reputationController.getReputationEvents(firstReq, firstRes);
    const { nextCursor } = firstRes.json.mock.calls[0][0];
    expect(nextCursor).toBeTruthy();

    const secondReq = {
      params: { address: VALID_ADDRESS },
      query: { limit: '20', cursor: nextCursor },
    };
    const secondRes = mockRes();
    await reputationController.getReputationEvents(secondReq, secondRes);

    expect(prismaMock.reputationEvent.findMany.mock.calls[1][0].skip).toBe(20);
  });

  it('responds with 500 when the service throws', async () => {
    prismaMock.reputationEvent.findMany.mockRejectedValue(new Error('db unavailable'));

    const req = { params: { address: VALID_ADDRESS }, query: {} };
    const res = mockRes();

    await reputationController.getReputationEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
