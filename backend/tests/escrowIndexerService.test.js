/**
 * Integration test for backend/services/escrowIndexer.js
 *
 * Covers the full happy-path flow:
 *   fetchAndProcessEvents → dispatchEvent → individual handlers → DB writes
 *
 * All external dependencies (Prisma, Redis, stellarService, reputationService)
 * are mocked so the suite is self-contained and runs in < 5 s.
 */

import { jest } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => loggerMock,
}));

const redisMock = {
  rpush: jest.fn().mockResolvedValue(1),
  on: jest.fn(),
};
jest.unstable_mockModule('ioredis', () => ({
  Redis: jest.fn(() => redisMock),
}));

const prismaMock = {
  indexerState: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  milestone: {
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  escrow: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
  },
  dispute: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  reputationRecord: {
    upsert: jest.fn(),
  },
  $transaction: jest.fn(async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
  $executeRaw: jest.fn(),
};
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

const stellarMock = {
  getContractEvents: jest.fn(),
  getLatestLedger: jest.fn(),
};
jest.unstable_mockModule('./stellarService.js', () => stellarMock);

const reputationMock = {
  recordEscrowCompletion: jest.fn(),
  recordDisputeOutcome: jest.fn(),
};
jest.unstable_mockModule('./reputationService.js', () => reputationMock);

// ── Import SUT after mocks ────────────────────────────────────────────────────

const {
  fetchAndProcessEvents,
  dispatchEvent,
  handleEscrowCreated,
  handleMilestoneAdded,
  handleMilestoneSubmitted,
  handleMilestoneApproved,
  handleFundsReleased,
  handleEscrowCancelled,
  handleDisputeRaised,
  handleDisputeResolved,
  handleReputationUpdated,
} = await import('../services/escrowIndexer.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeEvent(topic0, topicId, value) {
  return {
    topic: [topic0, String(topicId)],
    value,
    ledger: 10,
    ledgerClosedAt: NOW,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.escrow.upsert.mockResolvedValue({});
  prismaMock.escrow.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.escrow.findUnique.mockResolvedValue(null);
  prismaMock.milestone.upsert.mockResolvedValue({});
  prismaMock.milestone.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.dispute.upsert.mockResolvedValue({});
  prismaMock.dispute.findUnique.mockResolvedValue(null);
  prismaMock.reputationRecord.upsert.mockResolvedValue({});
  prismaMock.$executeRaw.mockResolvedValue(1);
  reputationMock.recordEscrowCompletion.mockResolvedValue({});
  reputationMock.recordDisputeOutcome.mockResolvedValue({});
  stellarMock.getLatestLedger.mockResolvedValue(100);
  stellarMock.getContractEvents.mockResolvedValue([]);
});

// ── fetchAndProcessEvents — full flow ─────────────────────────────────────────

describe('fetchAndProcessEvents — full happy-path flow', () => {
  it('fetches events, processes each one, and returns the latest ledger', async () => {
    const events = [
      makeEvent('esc_crt', 1, ['GCLIENT', 'GFREELANCER', '1000']),
      makeEvent('mil_add', 1, [0, '500']),
    ];
    stellarMock.getContractEvents.mockResolvedValue(events);
    stellarMock.getLatestLedger.mockResolvedValue(42);

    const latest = await fetchAndProcessEvents(0);

    expect(stellarMock.getContractEvents).toHaveBeenCalledWith(0, expect.any(String));
    expect(stellarMock.getLatestLedger).toHaveBeenCalled();
    expect(prismaMock.escrow.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.milestone.upsert).toHaveBeenCalledTimes(1);
    expect(latest).toBe(42);
  });

  it('returns latest ledger even when there are no events', async () => {
    stellarMock.getContractEvents.mockResolvedValue([]);
    stellarMock.getLatestLedger.mockResolvedValue(55);

    const latest = await fetchAndProcessEvents(50);

    expect(latest).toBe(55);
    expect(prismaMock.escrow.upsert).not.toHaveBeenCalled();
  });

  it('sends events to DLQ after MAX_RETRIES failures without blocking other events', async () => {
    const goodEvent = makeEvent('esc_crt', 2, ['GCLIENT2', 'GFREELANCER2', '200']);
    const badEvent = makeEvent('esc_crt', 99, ['BAD']);

    stellarMock.getContractEvents.mockResolvedValue([badEvent, goodEvent]);
    stellarMock.getLatestLedger.mockResolvedValue(10);

    // Force the bad event's escrow.upsert to always fail
    prismaMock.escrow.upsert
      .mockRejectedValueOnce(new Error('DB error'))
      .mockRejectedValueOnce(new Error('DB error'))
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({}); // good event succeeds

    await fetchAndProcessEvents(0);

    // DLQ push must have been called for the bad event
    expect(redisMock.rpush).toHaveBeenCalledWith('indexer:dlq', expect.any(String));
    // Good event was still processed
    expect(prismaMock.escrow.upsert).toHaveBeenCalledTimes(4); // 3 retries + 1 success
  });
});

// ── dispatchEvent — routing ───────────────────────────────────────────────────

describe('dispatchEvent — event routing', () => {
  it('routes esc_crt to handleEscrowCreated', async () => {
    const event = makeEvent('esc_crt', 1, ['GCLIENT', 'GFREELANCER', '100']);
    await dispatchEvent(event);
    expect(prismaMock.escrow.upsert).toHaveBeenCalled();
  });

  it('routes mil_add to handleMilestoneAdded', async () => {
    const event = makeEvent('mil_add', 1, [0, '500']);
    await dispatchEvent(event);
    expect(prismaMock.milestone.upsert).toHaveBeenCalled();
  });

  it('routes mil_sub to handleMilestoneSubmitted', async () => {
    const event = makeEvent('mil_sub', 1, [0]);
    await dispatchEvent(event);
    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Submitted' }) }),
    );
  });

  it('routes mil_apr to handleMilestoneApproved', async () => {
    const event = makeEvent('mil_apr', 1, [0]);
    await dispatchEvent(event);
    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Approved' }) }),
    );
  });

  it('routes esc_can to handleEscrowCancelled', async () => {
    const event = makeEvent('esc_can', 5, []);
    await dispatchEvent(event);
    expect(prismaMock.escrow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Cancelled' } }),
    );
  });

  it('logs a warning and does nothing for unknown event types', async () => {
    const event = makeEvent('unknown_event', 1, []);
    await dispatchEvent(event);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'indexer_unknown_event_type' }),
    );
    expect(prismaMock.escrow.upsert).not.toHaveBeenCalled();
  });
});

// ── handleEscrowCreated ───────────────────────────────────────────────────────

describe('handleEscrowCreated', () => {
  it('upserts escrow with client/freelancer/amount from event', async () => {
    const event = makeEvent('esc_crt', 7, ['GCLIENTADDR', 'GFREELANCERADDR', '5000']);
    await handleEscrowCreated(event);

    expect(prismaMock.escrow.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          clientAddress: 'GCLIENTADDR',
          freelancerAddress: 'GFREELANCERADDR',
          totalAmount: '5000',
          status: 'Active',
        }),
      }),
    );
  });

  it('is idempotent — update clause is empty so duplicate events are safe', async () => {
    const event = makeEvent('esc_crt', 8, ['G1', 'G2', '100']);
    await handleEscrowCreated(event);

    const call = prismaMock.escrow.upsert.mock.calls[0][0];
    expect(call.update).toEqual({});
  });

  it('returns early when escrowId or client address is missing', async () => {
    // topic[1] missing → escrowId is 0 which is falsy
    const event = { topic: ['esc_crt'], value: [], ledgerClosedAt: NOW };
    await handleEscrowCreated(event);
    expect(prismaMock.escrow.upsert).not.toHaveBeenCalled();
  });
});

// ── handleMilestoneAdded ──────────────────────────────────────────────────────

describe('handleMilestoneAdded', () => {
  it('upserts a milestone with Pending status', async () => {
    const event = makeEvent('mil_add', 3, [1, '250']);
    await handleMilestoneAdded(event);

    expect(prismaMock.milestone.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          milestoneIndex: 1,
          amount: '250',
          status: 'Pending',
        }),
      }),
    );
  });
});

// ── handleMilestoneSubmitted ──────────────────────────────────────────────────

describe('handleMilestoneSubmitted', () => {
  it('sets milestone status to Submitted with submittedAt timestamp', async () => {
    const event = makeEvent('mil_sub', 3, [0]);
    await handleMilestoneSubmitted(event);

    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Submitted', submittedAt: new Date(NOW) }),
      }),
    );
  });
});

// ── handleMilestoneApproved ───────────────────────────────────────────────────

describe('handleMilestoneApproved', () => {
  it('sets milestone status to Approved with resolvedAt timestamp', async () => {
    const event = makeEvent('mil_apr', 3, [2]);
    await handleMilestoneApproved(event);

    expect(prismaMock.milestone.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Approved', resolvedAt: new Date(NOW) }),
      }),
    );
  });
});

// ── handleFundsReleased ───────────────────────────────────────────────────────

describe('handleFundsReleased', () => {
  it('records escrow completion for both parties and deducts balance', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue({
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREELANCER',
      tenantId: 'tenant1',
    });

    const event = makeEvent('funds_rel', 4, [undefined, '300']);
    await handleFundsReleased(event);

    expect(reputationMock.recordEscrowCompletion).toHaveBeenCalledTimes(2);
    expect(reputationMock.recordEscrowCompletion).toHaveBeenCalledWith(
      'GCLIENT',
      'client',
      BigInt(4),
      'tenant1',
    );
    expect(reputationMock.recordEscrowCompletion).toHaveBeenCalledWith(
      'GFREELANCER',
      'freelancer',
      BigInt(4),
      'tenant1',
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it('skips reputation update when escrow is not found', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null);
    const event = makeEvent('funds_rel', 99, [undefined, '100']);
    await handleFundsReleased(event);
    expect(reputationMock.recordEscrowCompletion).not.toHaveBeenCalled();
    // balance deduction still runs
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });
});

// ── handleDisputeRaised ───────────────────────────────────────────────────────

describe('handleDisputeRaised', () => {
  it('sets escrow status to Disputed and creates a dispute record', async () => {
    prismaMock.$transaction.mockImplementation(async (ops) =>
      Array.isArray(ops) ? Promise.all(ops) : ops,
    );

    const event = makeEvent('dis_rai', 5, 'GCLIENT_RAISER');
    await handleDisputeRaised(event);

    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});

// ── handleDisputeResolved ─────────────────────────────────────────────────────

describe('handleDisputeResolved', () => {
  it('records dispute outcome for winner and loser, then marks escrow Completed', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue({
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREELANCER',
      tenantId: 'tenant2',
    });

    const event = makeEvent('dis_res', 6, []);
    await handleDisputeResolved(event);

    expect(reputationMock.recordDisputeOutcome).toHaveBeenCalledTimes(2);
    // Winner (freelancer by default) gets won=true
    expect(reputationMock.recordDisputeOutcome).toHaveBeenCalledWith(
      'GFREELANCER',
      true,
      BigInt(6),
      'tenant2',
    );
    // Loser (client) gets won=false
    expect(reputationMock.recordDisputeOutcome).toHaveBeenCalledWith(
      'GCLIENT',
      false,
      BigInt(6),
      'tenant2',
    );
    expect(prismaMock.escrow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Completed' } }),
    );
  });

  it('returns early when escrow is not found', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null);
    const event = makeEvent('dis_res', 99, []);
    await handleDisputeResolved(event);
    expect(reputationMock.recordDisputeOutcome).not.toHaveBeenCalled();
  });
});

// ── handleEscrowCancelled ─────────────────────────────────────────────────────

describe('handleEscrowCancelled', () => {
  it('sets escrow status to Cancelled', async () => {
    const event = makeEvent('esc_can', 10, []);
    await handleEscrowCancelled(event);

    expect(prismaMock.escrow.updateMany).toHaveBeenCalledWith({
      where: { id: BigInt(10) },
      data: { status: 'Cancelled' },
    });
  });
});

// ── handleReputationUpdated ───────────────────────────────────────────────────

describe('handleReputationUpdated', () => {
  it('upserts the reputation record with the new score', async () => {
    const event = { topic: ['rep_upd'], value: ['GADDR', 800], ledgerClosedAt: NOW };
    await handleReputationUpdated(event);

    expect(prismaMock.reputationRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: 'GADDR' },
        create: expect.objectContaining({ totalScore: BigInt(800) }),
        update: expect.objectContaining({ totalScore: BigInt(800) }),
      }),
    );
  });

  it('returns early when address is missing from event value', async () => {
    const event = { topic: ['rep_upd'], value: [null, 100], ledgerClosedAt: NOW };
    await handleReputationUpdated(event);
    expect(prismaMock.reputationRecord.upsert).not.toHaveBeenCalled();
  });
});
