/**
 * Payment Reconciliation Service
 *
 * Reconciles `Payment` records against Stellar transaction monitor outcomes so
 * that failed or unconfirmed on-chain submissions do not remain marked as
 * successful. Every correction is written to the audit log.
 *
 * Monitor status → expected payment status:
 *   CONFIRMED        → Completed
 *   FAILED / TIMEOUT → Failed
 *   PENDING          → Processing (only corrects payments already marked Completed)
 */

import prisma from '../lib/prisma.js';
import { createModuleLogger } from '../config/logger.js';
import auditService, { AuditCategory, AuditAction } from './auditService.js';
import { TxStatus } from './stellarMonitorService.js';

const log = createModuleLogger('paymentReconciliation');

export const RECONCILE_ACTOR = 'system:payment-reconciliation';

const RECONCILABLE_STATUSES = ['Pending', 'Processing', 'Completed'];

/**
 * Returns the payment status implied by a monitor outcome, or null when the
 * current payment status is already consistent.
 */
export function expectedPaymentStatus(paymentStatus, txStatus) {
  let expected;
  if (txStatus === TxStatus.CONFIRMED) expected = 'Completed';
  else if (txStatus === TxStatus.FAILED || txStatus === TxStatus.TIMEOUT) expected = 'Failed';
  else if (txStatus === TxStatus.PENDING)
    expected = paymentStatus === 'Completed' ? 'Processing' : null;
  else expected = null;

  return expected && expected !== paymentStatus ? expected : null;
}

function auditActionFor(status) {
  if (status === 'Completed') return AuditAction.PAYMENT_COMPLETED;
  if (status === 'Failed') return AuditAction.PAYMENT_FAILED;
  return AuditAction.PAYMENT_INITIATED;
}

/**
 * Reconcile a batch of payments linked to monitored transactions.
 *
 * @param {object} [opts]
 * @param {number} [opts.batchSize=100]
 * @returns {Promise<{ checked: number, updated: number, changes: Array<object> }>}
 */
export async function reconcilePayments({ batchSize = 100 } = {}) {
  const payments = await prisma.payment.findMany({
    where: { txHash: { not: null }, status: { in: RECONCILABLE_STATUSES } },
    take: batchSize,
    orderBy: { updatedAt: 'asc' },
  });
  if (payments.length === 0) return { checked: 0, updated: 0, changes: [] };

  const monitors = await prisma.transactionMonitor.findMany({
    where: { txHash: { in: payments.map((p) => p.txHash) } },
  });
  const monitorByHash = new Map(monitors.map((m) => [m.txHash, m]));

  const changes = [];
  for (const payment of payments) {
    const monitor = monitorByHash.get(payment.txHash);
    if (!monitor) continue;

    const nextStatus = expectedPaymentStatus(payment.status, monitor.status);
    if (!nextStatus) continue;

    await prisma.payment.update({ where: { id: payment.id }, data: { status: nextStatus } });

    const change = {
      paymentId: payment.id,
      txHash: payment.txHash,
      previousStatus: payment.status,
      newStatus: nextStatus,
      txStatus: monitor.status,
    };
    changes.push(change);

    await auditService.log({
      category: AuditCategory.PAYMENT,
      action: auditActionFor(nextStatus),
      actor: RECONCILE_ACTOR,
      resourceId: payment.id,
      metadata: { ...change, reconciled: true, errorCode: monitor.errorCode ?? null },
    });

    log.warn({ message: 'payment_reconciled', ...change });
  }

  return { checked: payments.length, updated: changes.length, changes };
}

export default { reconcilePayments, expectedPaymentStatus };
