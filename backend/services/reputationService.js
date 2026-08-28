const BADGE_THRESHOLDS = {
  TRUSTED: 100,
  VERIFIED: 250,
  EXPERT: 500,
  ELITE: 1000,
};

import prisma from '../lib/prisma.js';

// ── Read Operations ──────────────────────────────────────────────────────────

/**
 * Fetch the reputation record for a single Stellar address.
 *
 * @param {string} address - Stellar public key to look up.
 * @returns {Promise<Object|null>} The reputation record, or null if the
 *   address has no record yet.
 */
const getReputationByAddress = async (address) => {
  const record = await prisma.reputationRecord.findUnique({
    where: { address },
  });
  return record || null;
};

/**
 * Map a numeric reputation score to its badge tier.
 *
 * @param {number|string} score - Total reputation score.
 * @returns {'NEW'|'TRUSTED'|'VERIFIED'|'EXPERT'|'ELITE'} Badge tier name.
 */
const getBadge = (score) => {
  const s = Number(score);
  if (s >= BADGE_THRESHOLDS.ELITE) return 'ELITE';
  if (s >= BADGE_THRESHOLDS.EXPERT) return 'EXPERT';
  if (s >= BADGE_THRESHOLDS.VERIFIED) return 'VERIFIED';
  if (s >= BADGE_THRESHOLDS.TRUSTED) return 'TRUSTED';
  return 'NEW';
};

/**
 * Compute the completion rate as a percentage of completed vs disputed work.
 *
 * @param {number} completed - Number of completed escrows.
 * @param {number} disputed - Number of disputed escrows.
 * @returns {number} Completion rate percentage (0-100). Returns 0 if there
 *   is no history (completed + disputed === 0).
 */
const computeCompletionRate = (completed, disputed) => {
  const total = Number(completed) + Number(disputed);
  return total === 0 ? 0 : (Number(completed) / total) * 100;
};

/**
 * Fetch a page of the reputation leaderboard, ranked by total score.
 *
 * @param {number} [limit=20] - Number of records to return per page.
 * @param {number} [page=1] - 1-indexed page number.
 * @returns {Promise<Array<Object>>} Reputation records ordered by
 *   totalScore descending.
 */
const getLeaderboard = async (limit = 20, page = 1) => {
  const skip = (page - 1) * limit;
  return prisma.reputationRecord.findMany({
    orderBy: { totalScore: 'desc' },
    take: limit,
    skip,
  });
};

/**
 * Compute an address's percentile rank among all reputation records.
 *
 * @param {string} address - Stellar public key to rank.
 * @returns {Promise<number>} Percentile rank (0-100), rounded to the
 *   nearest integer. Returns 0 if the address has no record.
 */
const getPercentileRank = async (address) => {
  const result = await prisma.$queryRaw`
    WITH Ranked AS (
      SELECT address, PERCENT_RANK() OVER (ORDER BY total_score ASC) as rank
      FROM reputation_records
    )
    SELECT rank FROM Ranked WHERE address = ${address}
  `;
  if (result.length > 0) {
    return Math.round(Number(result[0].rank) * 100);
  }
  return 0;
};

// ── Write Operations ────────────────────────────────────────────────────────

/**
 * Record escrow completion and update reputation.
 *
 * @param {string} address - Stellar address
 * @param {'client'|'freelancer'} role - Address role in escrow
 * @param {BigInt} escrowId - Escrow ID for idempotency
 * @param {string} tenantId - Tenant context
 * @returns {Promise<void>}
 */
const recordEscrowCompletion = async (address, role, escrowId, tenantId) => {
  // Score delta: +10 for freelancer, +5 for client
  const scoreDelta = role === 'freelancer' ? 10 : 5;

  // Upsert reputation event (idempotent on address, eventType, escrowId)
  await prisma.reputationEvent.upsert({
    where: {
      address_eventType_escrowId: {
        address,
        eventType: 'ESCROW_COMPLETED',
        escrowId,
      },
    },
    create: {
      address,
      eventType: 'ESCROW_COMPLETED',
      escrowId,
      scoreDelta,
      tenantId,
    },
    update: {}, // No-op on conflict (already recorded)
  });

  // Atomically increment completedEscrows and totalScore
  await prisma.reputationRecord.update({
    where: { address },
    data: {
      completedEscrows: { increment: 1 },
      totalScore: { increment: scoreDelta },
      lastUpdated: new Date(),
    },
  });
};

/**
 * Record dispute resolution and update reputation.
 *
 * @param {string} address - Stellar address
 * @param {boolean} won - True if dispute won, false if lost
 * @param {BigInt} escrowId - Escrow ID for idempotency
 * @param {string} tenantId - Tenant context
 * @returns {Promise<void>}
 */
const recordDisputeOutcome = async (address, won, escrowId, tenantId) => {
  const scoreDelta = won ? 15 : -5;
  const eventType = won ? 'DISPUTE_WON' : 'DISPUTE_LOST';

  // Upsert reputation event (idempotent on address, eventType, escrowId)
  await prisma.reputationEvent.upsert({
    where: {
      address_eventType_escrowId: {
        address,
        eventType,
        escrowId,
      },
    },
    create: {
      address,
      eventType,
      escrowId,
      scoreDelta,
      tenantId,
    },
    update: {}, // No-op on conflict (already recorded)
  });

  // Atomically update: increment/decrement score, track disputesWon
  const data = {
    lastUpdated: new Date(),
  };

  if (won) {
    data.disputesWon = { increment: 1 };
    data.totalScore = { increment: 15 };
  } else {
    // Decrement score, floor at 0
    data.totalScore = { decrement: 5 };
  }

  const updated = await prisma.reputationRecord.update({
    where: { address },
    data,
  });

  // Floor totalScore at 0
  if (updated.totalScore < 0) {
    await prisma.reputationRecord.update({
      where: { address },
      data: { totalScore: 0 },
    });
  }
};

/**
 * Record escrow cancellation and penalty if at fault.
 *
 * @param {string} address - Stellar address
 * @param {boolean} wasAtFault - True if address was at fault for cancellation
 * @param {BigInt} escrowId - Escrow ID for idempotency
 * @param {string} tenantId - Tenant context
 * @returns {Promise<void>}
 */
const recordEscrowCancellation = async (address, wasAtFault, escrowId, tenantId) => {
  if (!wasAtFault) return;

  const scoreDelta = -8;

  // Upsert reputation event
  await prisma.reputationEvent.upsert({
    where: {
      address_eventType_escrowId: {
        address,
        eventType: 'CANCELLATION',
        escrowId,
      },
    },
    create: {
      address,
      eventType: 'CANCELLATION',
      escrowId,
      scoreDelta,
      tenantId,
    },
    update: {}, // No-op on conflict
  });

  // Decrement score, floor at 0
  const updated = await prisma.reputationRecord.update({
    where: { address },
    data: {
      totalScore: { decrement: 8 },
      lastUpdated: new Date(),
    },
  });

  if (updated.totalScore < 0) {
    await prisma.reputationRecord.update({
      where: { address },
      data: { totalScore: 0 },
    });
  }
};

/**
 * Recalculate all reputation scores from event history.
 * Used for corrections after bugs or audits.
 *
 * @param {string} tenantId - Tenant context (optional, all if not specified)
 * @returns {Promise<void>}
 */
const recalculateFromEventHistory = async (tenantId) => {
  const where = tenantId ? { tenantId } : {};

  // Get all unique addresses with events
  const addresses = await prisma.reputationEvent.findMany({
    where,
    distinct: ['address'],
    select: { address: true },
  });

  for (const { address } of addresses) {
    // Fetch all events for this address, sorted by creation time
    const events = await prisma.reputationEvent.findMany({
      where: { address },
      orderBy: { createdAt: 'asc' },
    });

    // Compute score from scratch
    let totalScore = 0;
    let completedEscrows = 0;
    let disputesWon = 0;

    for (const event of events) {
      totalScore += event.scoreDelta;
      if (event.eventType === 'ESCROW_COMPLETED') completedEscrows += 1;
      if (event.eventType === 'DISPUTE_WON') disputesWon += 1;
    }

    // Floor at 0
    totalScore = Math.max(0, totalScore);

    // Update record
    await prisma.reputationRecord.update({
      where: { address },
      data: {
        totalScore,
        completedEscrows,
        disputesWon,
        lastUpdated: new Date(),
      },
    });
  }
};

export {
  BADGE_THRESHOLDS,
  computeCompletionRate,
  getBadge,
  getLeaderboard,
  getPercentileRank,
  getReputationByAddress,
  recordEscrowCompletion,
  recordDisputeOutcome,
  recordEscrowCancellation,
  recalculateFromEventHistory,
};

export default {
  getReputationByAddress,
  getBadge,
  computeCompletionRate,
  getLeaderboard,
  getPercentileRank,
  BADGE_THRESHOLDS,
  recordEscrowCompletion,
  recordDisputeOutcome,
  recordEscrowCancellation,
  recalculateFromEventHistory,
};
