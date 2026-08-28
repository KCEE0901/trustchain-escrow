import express from 'express';
import reputationController from '../controllers/reputationController.js';
import { cacheResponse, TTL } from '../middleware/cache.js';
import { reputationSearchRateLimit } from '../../middleware/rateLimit.js';

const router = express.Router();

/**
 * Search reputation records by address prefix or full-text query.
 *
 * Uses Elasticsearch for address autocomplete and full-text matching, with
 * an automatic Prisma fallback when the ES cluster is unavailable.
 *
 * @description ES-backed address autocomplete + full-text search. Prisma fallback on outage.
 * @route   GET /api/reputation/search?q=<prefix>
 * @param   {string} q - Address prefix or search term to match against reputation records.
 * @param   {number} [limit=10] - Maximum number of results to return (capped at 50).
 * @returns {object} 200 - `{ results: Array<{ address: string, totalScore: number, badge: string }> }`
 * @returns {object} 400 - `{ error: string }` when `q` is missing or too short.
 * @returns {object} 429 - Rate limit exceeded.
 * @access  Public
 */
router.get('/search', reputationSearchRateLimit, reputationController.search);

/**
 * Retrieve the global reputation leaderboard.
 *
 * Returns reputation records ordered by total score descending. Responses are
 * cached and tagged so that any score update can selectively invalidate the
 * leaderboard without flushing unrelated entries.
 *
 * @description Returns the top-scored addresses on the platform, ordered by totalScore descending.
 * @route   GET /api/reputation/leaderboard
 * @param   {number} [limit=20] - Number of entries to return per page (max 100).
 * @param   {number} [page=1]   - Page number for cursor-based pagination.
 * @returns {object} 200 - `{ leaderboard: Array<{ rank: number, address: string, totalScore: number, badge: string, completedEscrows: number }>, total: number }`
 * @access  Public
 */
router.get(
  '/leaderboard',
  cacheResponse({ ttl: TTL.LEADERBOARD, tags: ['reputation:leaderboard'] }),
  reputationController.getLeaderboard,
);

/**
 * Trigger a full recalculation of all reputation scores from raw event history.
 *
 * Replays every `ReputationEvent` row in order and recomputes each address's
 * `totalScore`, `completedEscrows`, and `disputesWon` from scratch. Intended
 * for use after a scoring-logic bug fix or a manual audit correction. May take
 * several seconds on large datasets.
 *
 * @description Admin-only: recompute all reputation scores from event history.
 * @route   POST /api/reputation/admin/recalculate
 * @param   {string} [tenantId] - Optional tenant scope; omit to recalculate across all tenants.
 * @returns {object} 200 - `{ message: string, addressesProcessed: number }`
 * @returns {object} 401 - Unauthorized — valid admin JWT required.
 * @returns {object} 403 - Forbidden — caller does not hold the `admin` role.
 * @access  Admin
 */
router.post('/admin/recalculate', reputationController.recalculate);

/**
 * Retrieve the reputation record for a single Stellar address.
 *
 * Returns the address's accumulated score, badge tier, completed-escrow count,
 * dispute win/loss record, and the timestamp of the most recent score change.
 * Responses are cached per-address and tagged so targeted invalidation is
 * possible after any write that touches this address.
 *
 * @description Returns the full reputation profile for the given Stellar address.
 * @route   GET /api/reputation/:address
 * @param   {string} address - The Stellar public key (G… address) to look up.
 * @param   {string} [from]  - ISO-8601 date; restrict returned event history to events after this date.
 * @returns {object} 200 - `{ address: string, totalScore: number, badge: string, completedEscrows: number, disputesWon: number, lastUpdated: string }`
 * @returns {object} 404 - `{ error: string }` when no reputation record exists for the address.
 * @access  Public
 */
router.get(
  '/:address',
  cacheResponse({
    ttl: TTL.REPUTATION,
    tags: (req) => ['reputation', `reputation:${req.params.address}`],
  }),
  reputationController.getReputation,
);

export default router;
