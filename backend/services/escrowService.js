/**
 * Escrow Service
 *
 * All multi-table write operations wrapped in Prisma transactions
 * with deadlock retry via withTransaction().
 */

import { withTransaction } from '../lib/transaction.js';
import prisma from '../lib/prisma.js';
import cache from '../lib/cache.js';
import { createModuleLogger } from '../config/logger.js';

const logger = createModuleLogger('escrowService');

export const ESCROW_TRANSITIONS = Object.freeze({
  Active: new Set(['Disputed', 'Completed', 'Cancelled']),
  Disputed: new Set(['Completed', 'Cancelled']),
  Completed: new Set(),
  Cancelled: new Set(),
});

export function assertEscrowTransition(fromStatus, toStatus) {
  if (!ESCROW_TRANSITIONS[fromStatus]) {
    throw Object.assign(new Error(`Unknown escrow status: ${fromStatus}`), {
      statusCode: 422,
      code: 'ESCROW_STATUS_UNKNOWN',
    });
  }

  if (!ESCROW_TRANSITIONS[fromStatus].has(toStatus)) {
    throw Object.assign(new Error(`Invalid escrow transition from ${fromStatus} to ${toStatus}`), {
      statusCode: 409,
      code: 'ESCROW_TRANSITION_INVALID',
    });
  }
}

async function invalidateEscrowCache(escrowId) {
  await cache.invalidateTags([
    'escrows',
    `escrow:${escrowId}`,
    'stats:volume',
    'stats:active',
    'stats:success',
  ]);
}

async function withEscrowCacheInvalidation(escrowId, operation) {
  const result = await operation();
  try {
    await invalidateEscrowCache(escrowId);
  } catch (err) {
    logger.warn({
      message: 'escrow_cache_invalidation_failed',
      escrowId: String(escrowId),
      error: err.message,
    });
  }
  return result;
}

export async function fundEscrow(data) {
  return withTransaction(
    async (tx) => {
      const escrow = await tx.escrow.create({
        data: {
          id: BigInt(data.id),
          clientAddress: data.clientAddress,
          freelancerAddress: data.freelancerAddress,
          arbiterAddress: data.arbiterAddress ?? null,
          tokenAddress: data.tokenAddress,
          totalAmount: String(data.totalAmount),
          remainingBalance: String(data.totalAmount),
          status: 'Active',
          briefHash: data.briefHash,
          deadline: data.deadline ?? null,
          createdAt: new Date(),
          createdLedger: BigInt(data.createdLedger ?? 0),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          action: 'ESCROW_FUNDED',
          targetAddress: data.clientAddress,
          reason: `Escrow ${escrow.id} funded with ${data.totalAmount}`,
          performedBy: data.clientAddress,
          performedAt: new Date(),
        },
      });

      return escrow;
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function releaseMilestone({ escrowId, milestoneIndex, amount, callerAddress }) {
  return withEscrowCacheInvalidation(escrowId, () =>
    withTransaction(async (tx) => {
      const escrow = await tx.escrow.findUniqueOrThrow({
        where: { id: BigInt(escrowId) },
        select: { remainingBalance: true, status: true },
      });

      if (escrow.status !== 'Active') {
        throw Object.assign(new Error('Escrow is not active'), {
          statusCode: 409,
          code: 'ESCROW_TRANSITION_INVALID',
        });
      }

      const newBalance = BigInt(escrow.remainingBalance) - BigInt(amount);
      if (newBalance < 0n) {
        throw Object.assign(new Error('Insufficient escrow balance'), { statusCode: 422 });
      }

      const [milestone, updatedEscrow] = await Promise.all([
        tx.milestone.update({
          where: { escrowId_milestoneIndex: { escrowId: BigInt(escrowId), milestoneIndex } },
          data: { status: 'Approved', resolvedAt: new Date() },
        }),
        tx.escrow.update({
          where: { id: BigInt(escrowId) },
          data: {
            remainingBalance: String(newBalance),
            ...(newBalance === 0n ? { status: 'Completed' } : {}),
          },
        }),
        tx.adminAuditLog.create({
          data: {
            action: 'MILESTONE_RELEASED',
            targetAddress: callerAddress,
            reason: `Milestone ${milestoneIndex} of escrow ${escrowId} released`,
            performedBy: callerAddress,
            performedAt: new Date(),
          },
        }),
      ]);

      return { milestone, escrow: updatedEscrow };
    }),
  );
}

export async function raiseDispute({ escrowId, raisedByAddress, milestoneIndex }) {
  return withEscrowCacheInvalidation(escrowId, () =>
    withTransaction(
      async (tx) => {
        const escrow = await tx.escrow.findUniqueOrThrow({
          where: { id: BigInt(escrowId) },
          select: { status: true },
        });

        assertEscrowTransition(escrow.status, 'Disputed');

        const ops = [
          tx.escrow.update({ where: { id: BigInt(escrowId) }, data: { status: 'Disputed' } }),
          tx.dispute.create({
            data: { escrowId: BigInt(escrowId), raisedByAddress, raisedAt: new Date() },
          }),
          tx.adminAuditLog.create({
            data: {
              action: 'DISPUTE_RAISED',
              targetAddress: raisedByAddress,
              reason: `Dispute raised on escrow ${escrowId}`,
              performedBy: raisedByAddress,
              performedAt: new Date(),
            },
          }),
        ];

        if (milestoneIndex !== undefined) {
          ops.push(
            tx.milestone.updateMany({
              where: { escrowId: BigInt(escrowId), milestoneIndex },
              data: { status: 'Rejected' },
            }),
          );
        }

        const [updatedEscrow, dispute] = await Promise.all(ops);
        return { dispute, escrow: updatedEscrow };
      },
      { isolationLevel: 'Serializable' },
    ),
  );
}

export async function resolveDispute({
  escrowId,
  clientAmount,
  freelancerAmount,
  resolvedBy,
  resolution,
}) {
  return withEscrowCacheInvalidation(escrowId, () =>
    withTransaction(
      async (tx) => {
        const escrow = await tx.escrow.findUniqueOrThrow({
          where: { id: BigInt(escrowId) },
          select: { status: true, remainingBalance: true },
        });

        assertEscrowTransition(escrow.status, 'Completed');

        const total = BigInt(clientAmount) + BigInt(freelancerAmount);
        if (total !== BigInt(escrow.remainingBalance)) {
          throw Object.assign(new Error('Amounts must sum to remaining balance'), {
            statusCode: 422,
          });
        }

        const [updatedEscrow, dispute] = await Promise.all([
          tx.escrow.update({
            where: { id: BigInt(escrowId) },
            data: { status: 'Completed', remainingBalance: '0' },
          }),
          tx.dispute.update({
            where: { escrowId: BigInt(escrowId) },
            data: {
              resolvedAt: new Date(),
              clientAmount: String(clientAmount),
              freelancerAmount: String(freelancerAmount),
              resolvedBy,
              resolution,
            },
          }),
          tx.adminAuditLog.create({
            data: {
              action: 'DISPUTE_RESOLVED',
              targetAddress: resolvedBy,
              reason: resolution ?? `Dispute on escrow ${escrowId} resolved`,
              performedBy: resolvedBy,
              performedAt: new Date(),
            },
          }),
        ]);

        return { dispute, escrow: updatedEscrow };
      },
      { isolationLevel: 'Serializable' },
    ),
  );
}

export async function transitionEscrowStatus({ escrowId, toStatus, actorAddress, reason }) {
  return withEscrowCacheInvalidation(escrowId, () =>
    withTransaction(
      async (tx) => {
        const escrow = await tx.escrow.findUniqueOrThrow({
          where: { id: BigInt(escrowId) },
          select: { id: true, status: true },
        });

        assertEscrowTransition(escrow.status, toStatus);

        const updatedEscrow = await tx.escrow.update({
          where: { id: BigInt(escrowId) },
          data: { status: toStatus },
        });

        await tx.adminAuditLog.create({
          data: {
            action: 'ESCROW_STATUS_CHANGED',
            targetAddress: actorAddress,
            reason:
              reason ?? `Escrow ${escrowId} transitioned from ${escrow.status} to ${toStatus}`,
            performedBy: actorAddress,
            performedAt: new Date(),
          },
        });

        return updatedEscrow;
      },
      { isolationLevel: 'Serializable' },
    ),
  );
}

export default {
  fundEscrow,
  releaseMilestone,
  raiseDispute,
  resolveDispute,
  transitionEscrowStatus,
  assertEscrowTransition,
  ESCROW_TRANSITIONS,
};
