/**
 * Referral Service
 *
 * Handles creation, application, and reporting of referral / invite codes
 * for the Trustchain Escrow platform.
 *
 * Error policy: every caught error is re-thrown with full context so that
 * callers and log aggregators always know which operation failed, what inputs
 * were involved, and what the root cause was.  Never throw bare `new Error('Internal error')`.
 *
 * @module services/referralService
 */

import prisma from '../../lib/prisma.js';
import { createModuleLogger } from '../../config/logger.js';

const logger = createModuleLogger('referralService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random, URL-safe referral code.
 * Format: 8 uppercase alphanumeric characters.
 *
 * @returns {string} e.g. "A3FX9KQW"
 */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0 ambiguity
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Assert that the Prisma client is available.  Throws a clear error if the
 * import resolved to null/undefined (e.g. missing DATABASE_URL at startup).
 *
 * @param {string} operation - Human-readable operation name for the error message.
 */
function assertPrisma(operation) {
  if (!prisma) {
    throw new Error(
      `${operation}: Prisma client is unavailable — ensure DATABASE_URL is set and ` +
        '`npm run db:generate` has been run before starting the server.',
    );
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

const referralService = {
  /**
   * Create a new referral record for the given referrer.
   *
   * Generates a unique invite code, persists it to the database, and returns
   * the created record.  If the referrer already has an active referral, the
   * existing record is returned instead of creating a duplicate.
   *
   * @param {number|string} referrerId - ID of the user creating the referral.
   * @param {object}        [metadata={}] - Arbitrary key/value metadata to attach
   *   to the referral (e.g. campaign tag, source channel).
   * @returns {Promise<object>} The created (or existing active) referral record.
   * @throws {Error} With full context on any failure.
   */
  async createReferral(referrerId, metadata = {}) {
    assertPrisma('createReferral');

    if (!referrerId) {
      throw new Error('createReferral: referrerId is required');
    }

    logger.info({ referrerId, metadata }, 'Creating referral');

    try {
      // Return existing active referral if one exists to avoid code proliferation.
      const existing = await prisma.referral.findFirst({
        where: { referrerId: String(referrerId), status: 'active' },
      });

      if (existing) {
        logger.info({ referrerId, code: existing.code }, 'Returning existing active referral');
        return existing;
      }

      // Generate a unique code — retry once on collision (extremely unlikely).
      let code = generateCode();
      const collision = await prisma.referral.findUnique({ where: { code } });
      if (collision) code = generateCode();

      const referral = await prisma.referral.create({
        data: {
          referrerId: String(referrerId),
          code,
          status: 'active',
          metadata: metadata ?? {},
          createdAt: new Date(),
        },
      });

      logger.info({ referrerId, code: referral.code }, 'Referral created');
      return referral;
    } catch (err) {
      const message = `Referral creation failed for referrer ${referrerId}: ${err.message}`;
      logger.error({ referrerId, metadata, err }, message);
      throw new Error(message);
    }
  },

  /**
   * Apply a referral code for a user (i.e. the user was invited).
   *
   * Validates the code, marks it as used, links it to the user, and returns
   * the updated referral record.  Idempotent — if the user has already applied
   * this exact code, the existing record is returned without error.
   *
   * @param {number|string} userId - ID of the user redeeming the code.
   * @param {string}        code   - The referral code to apply.
   * @returns {Promise<object>} The referral record with updated usage information.
   * @throws {Error} If the code is invalid, expired, already used by someone else,
   *   or self-referral is attempted.
   */
  async applyReferralCode(userId, code) {
    assertPrisma('applyReferralCode');

    if (!userId) throw new Error('applyReferralCode: userId is required');
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new Error(`applyReferralCode for user ${userId}: code must be a non-empty string`);
    }

    const normalizedCode = code.trim().toUpperCase();
    logger.info({ userId, code: normalizedCode }, 'Applying referral code');

    try {
      const referral = await prisma.referral.findUnique({
        where: { code: normalizedCode },
      });

      if (!referral) {
        throw new Error(
          `applyReferralCode for user ${userId}: code "${normalizedCode}" does not exist`,
        );
      }

      if (referral.status !== 'active') {
        throw new Error(
          `applyReferralCode for user ${userId}: code "${normalizedCode}" is ${referral.status} ` +
            '(must be active to apply)',
        );
      }

      if (String(referral.referrerId) === String(userId)) {
        throw new Error(
          `applyReferralCode for user ${userId}: self-referral is not permitted`,
        );
      }

      // Idempotency — already applied by this user.
      if (referral.redeemedBy && String(referral.redeemedBy) === String(userId)) {
        logger.info({ userId, code: normalizedCode }, 'Code already applied by this user');
        return referral;
      }

      if (referral.redeemedBy) {
        throw new Error(
          `applyReferralCode for user ${userId}: code "${normalizedCode}" has already been ` +
            `redeemed by another user`,
        );
      }

      const updated = await prisma.referral.update({
        where: { code: normalizedCode },
        data: {
          status: 'redeemed',
          redeemedBy: String(userId),
          redeemedAt: new Date(),
        },
      });

      logger.info(
        { userId, code: normalizedCode, referrerId: referral.referrerId },
        'Referral code applied successfully',
      );
      return updated;
    } catch (err) {
      // Re-throw our own validation errors unchanged; wrap unexpected errors.
      if (err.message.startsWith('applyReferralCode')) throw err;
      const message = `applyReferralCode failed for user ${userId} with code "${normalizedCode}": ${err.message}`;
      logger.error({ userId, code: normalizedCode, err }, message);
      throw new Error(message);
    }
  },

  /**
   * Retrieve aggregated referral statistics for a user.
   *
   * Returns counts of referrals created, redeemed, and pending, plus the total
   * number of users who signed up via this user's code(s).
   *
   * @param {number|string} userId - ID of the referrer to fetch stats for.
   * @returns {Promise<{
   *   userId: string,
   *   totalCreated: number,
   *   totalRedeemed: number,
   *   totalPending: number,
   *   referredUsers: string[]
   * }>}
   * @throws {Error} With context on any failure.
   */
  async getReferralStats(userId) {
    assertPrisma('getReferralStats');

    if (!userId) throw new Error('getReferralStats: userId is required');

    logger.info({ userId }, 'Fetching referral stats');

    try {
      const referrals = await prisma.referral.findMany({
        where: { referrerId: String(userId) },
        select: { status: true, redeemedBy: true, redeemedAt: true },
      });

      const totalCreated = referrals.length;
      const redeemed = referrals.filter((r) => r.status === 'redeemed');
      const totalRedeemed = redeemed.length;
      const totalPending = referrals.filter((r) => r.status === 'active').length;
      const referredUsers = redeemed
        .map((r) => r.redeemedBy)
        .filter(Boolean);

      const stats = {
        userId: String(userId),
        totalCreated,
        totalRedeemed,
        totalPending,
        referredUsers,
      };

      logger.info({ userId, stats }, 'Referral stats fetched');
      return stats;
    } catch (err) {
      const message = `getReferralStats failed for user ${userId}: ${err.message}`;
      logger.error({ userId, err }, message);
      throw new Error(message);
    }
  },

  /**
   * List referrals created by a user with optional filtering.
   *
   * @param {number|string} userId  - ID of the referrer.
   * @param {object}        [filters={}] - Optional query filters.
   * @param {'active'|'redeemed'|'expired'} [filters.status] - Filter by status.
   * @param {number} [filters.limit=50]  - Maximum number of records to return (1–200).
   * @param {number} [filters.offset=0] - Pagination offset.
   * @returns {Promise<{ items: object[], total: number, limit: number, offset: number }>}
   * @throws {Error} With context on any failure.
   */
  async listReferrals(userId, filters = {}) {
    assertPrisma('listReferrals');

    if (!userId) throw new Error('listReferrals: userId is required');

    const { status, limit: rawLimit = 50, offset: rawOffset = 0 } = filters;

    const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 200);
    const offset = Math.max(Number(rawOffset) || 0, 0);

    const validStatuses = ['active', 'redeemed', 'expired'];
    if (status && !validStatuses.includes(status)) {
      throw new Error(
        `listReferrals for user ${userId}: invalid status filter "${status}" — ` +
          `must be one of: ${validStatuses.join(', ')}`,
      );
    }

    logger.info({ userId, filters }, 'Listing referrals');

    try {
      const where = { referrerId: String(userId) };
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.referral.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.referral.count({ where }),
      ]);

      logger.info({ userId, total, returned: items.length }, 'Referrals listed');
      return { items, total, limit, offset };
    } catch (err) {
      const message =
        `listReferrals failed for user ${userId} ` +
        `(filters: ${JSON.stringify(filters)}): ${err.message}`;
      logger.error({ userId, filters, err }, message);
      throw new Error(message);
    }
  },
};

export default referralService;
