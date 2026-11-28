import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prismaMock = {
  escrow: { findMany: jest.fn() },
  contractEvent: { findMany: jest.fn() },
};

jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));

const { detectDrift, findStatusDrift } = await import('../../services/escrowDriftDetector.js');

const ev = (escrowId, eventType, ledger) => ({
  escrowId: BigInt(escrowId),
  eventType,
  ledger: BigInt(ledger),
  ledgerAt: new Date(ledger * 1000),
  txHash: `tx-${eventType}-${ledger}`,
});

describe('escrow status drift detector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null for a clean escrow', () => {
    const events = [ev(1, 'esc_crt', 10), ev(1, 'mil_add', 11), ev(1, 'esc_can', 12)];
    expect(detectDrift({ id: 1n, status: 'Cancelled' }, events)).toBeNull();
  });

  it('flags a stale DB status with the last event', () => {
    const events = [ev(2, 'esc_crt', 10), ev(2, 'dis_rai', 20), ev(2, 'mil_sub', 21)];
    expect(detectDrift({ id: 2n, status: 'Active' }, events)).toEqual({
      escrowId: '2',
      dbStatus: 'Active',
      inferredStatus: 'Disputed',
      lastEvent: {
        eventType: 'mil_sub',
        ledger: '21',
        ledgerAt: new Date(21000),
        txHash: 'tx-mil_sub-21',
      },
      reason: 'stale_status',
    });
  });

  it('flags impossible sequences after a terminal status', () => {
    const events = [ev(3, 'esc_crt', 10), ev(3, 'esc_can', 11), ev(3, 'dis_rai', 12)];
    const drift = detectDrift({ id: 3n, status: 'Disputed' }, events);
    expect(drift.reason).toMatch(/^impossible_sequence: dis_rai after terminal status Cancelled/);
    expect(drift.inferredStatus).toBe('Disputed');
  });

  it('flags escrows with no status events', () => {
    const drift = detectDrift({ id: 4n, status: 'Active' }, []);
    expect(drift).toMatchObject({
      escrowId: '4',
      inferredStatus: null,
      lastEvent: null,
      reason: 'no_status_events',
    });
  });

  it('scans escrows and returns only drifting records', async () => {
    prismaMock.escrow.findMany.mockResolvedValue([
      { id: 1n, status: 'Active' },
      { id: 2n, status: 'Active' },
    ]);
    prismaMock.contractEvent.findMany.mockResolvedValue([
      ev(1, 'esc_crt', 10),
      ev(2, 'esc_crt', 10),
      ev(2, 'dis_res', 30),
    ]);

    const result = await findStatusDrift({ tenantId: 't1' });

    expect(prismaMock.escrow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      escrowId: '2',
      dbStatus: 'Active',
      inferredStatus: 'Completed',
    });
  });

  it('returns an empty list when there are no escrows', async () => {
    prismaMock.escrow.findMany.mockResolvedValue([]);
    await expect(findStatusDrift()).resolves.toEqual([]);
    expect(prismaMock.contractEvent.findMany).not.toHaveBeenCalled();
  });
});
