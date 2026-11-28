import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prismaMock = {
  payment: { findMany: jest.fn(), update: jest.fn() },
  transactionMonitor: { findMany: jest.fn() },
};
const auditServiceMock = { log: jest.fn() };

jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../../services/stellarService.js', () => ({
  getLatestLedger: jest.fn(),
}));
jest.unstable_mockModule('../../services/auditService.js', () => ({
  AuditAction: {
    PAYMENT_INITIATED: 'PAYMENT_INITIATED',
    PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
  },
  AuditCategory: { PAYMENT: 'PAYMENT' },
  default: auditServiceMock,
}));

const { reconcilePayments, RECONCILE_ACTOR } =
  await import('../../services/paymentReconciliationService.js');

describe('payment reconciliation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks a successful payment as failed when the transaction failed', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p1', status: 'Completed', txHash: '1'.repeat(64) },
    ]);
    prismaMock.transactionMonitor.findMany.mockResolvedValue([
      { txHash: '1'.repeat(64), status: 'FAILED', errorCode: 'tx_bad_seq' },
    ]);

    const result = await reconcilePayments();

    expect(result.updated).toBe(1);
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'Failed' },
    });
    expect(auditServiceMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYMENT_FAILED',
        actor: RECONCILE_ACTOR,
        resourceId: 'p1',
        metadata: expect.objectContaining({ previousStatus: 'Completed', errorCode: 'tx_bad_seq' }),
      }),
    );
  });

  it('treats timed-out transactions as failed', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p2', status: 'Processing', txHash: '2'.repeat(64) },
    ]);
    prismaMock.transactionMonitor.findMany.mockResolvedValue([
      { txHash: '2'.repeat(64), status: 'TIMEOUT' },
    ]);

    const result = await reconcilePayments();

    expect(result.changes[0]).toMatchObject({ newStatus: 'Failed', txStatus: 'TIMEOUT' });
  });

  it('downgrades a completed payment whose transaction is still pending', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p3', status: 'Completed', txHash: '3'.repeat(64) },
      { id: 'p4', status: 'Processing', txHash: '4'.repeat(64) },
    ]);
    prismaMock.transactionMonitor.findMany.mockResolvedValue([
      { txHash: '3'.repeat(64), status: 'PENDING' },
      { txHash: '4'.repeat(64), status: 'PENDING' },
    ]);

    const result = await reconcilePayments();

    expect(result.updated).toBe(1);
    expect(prismaMock.payment.update).toHaveBeenCalledWith({
      where: { id: 'p3' },
      data: { status: 'Processing' },
    });
  });

  it('completes a processing payment whose transaction confirmed', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p5', status: 'Processing', txHash: '5'.repeat(64) },
    ]);
    prismaMock.transactionMonitor.findMany.mockResolvedValue([
      { txHash: '5'.repeat(64), status: 'CONFIRMED' },
    ]);

    const result = await reconcilePayments();

    expect(result.changes[0]).toMatchObject({ newStatus: 'Completed' });
    expect(auditServiceMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_COMPLETED' }),
    );
  });

  it('leaves consistent and unmonitored payments untouched', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p6', status: 'Completed', txHash: '6'.repeat(64) },
      { id: 'p7', status: 'Completed', txHash: '7'.repeat(64) },
    ]);
    prismaMock.transactionMonitor.findMany.mockResolvedValue([
      { txHash: '6'.repeat(64), status: 'CONFIRMED' },
    ]);

    const result = await reconcilePayments();

    expect(result).toEqual({ checked: 2, updated: 0, changes: [] });
    expect(prismaMock.payment.update).not.toHaveBeenCalled();
    expect(auditServiceMock.log).not.toHaveBeenCalled();
  });

  it('ignores payment records with malformed transaction hashes', async () => {
    prismaMock.payment.findMany.mockResolvedValue([
      { id: 'p8', status: 'Processing', txHash: 'not-a-stellar-hash' },
    ]);

    await expect(reconcilePayments()).resolves.toEqual({ checked: 0, updated: 0, changes: [] });
    expect(prismaMock.transactionMonitor.findMany).not.toHaveBeenCalled();
    expect(prismaMock.payment.update).not.toHaveBeenCalled();
  });
});
