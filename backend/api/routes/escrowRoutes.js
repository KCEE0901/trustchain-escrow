import express from 'express';
import escrowController, {
  validateBroadcast,
  validateEscrowId,
  validatePagination,
} from '../controllers/escrowController.js';
import { cacheResponse, invalidateOn, TTL } from '../middleware/cache.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * Build a tenant-scoped cache key for the escrow detail endpoint.
 * Format: escrow:<tenantId>:<escrowId>
 * Falls back to '_global' when no tenant is resolved (e.g. single-tenant setups).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function escrowDetailCacheKey(req) {
  const tenantId = req.tenant?.id ?? '_global';
  const escrowId = req.params.id;
  return `escrow:${tenantId}:${escrowId}`;
}

/**
 * @route  GET /api/escrows
 */
router.get(
  '/',
  validatePagination,
  cacheResponse({
    ttl: TTL.LIST,
    tags: (req) => ['escrows', `escrow:list:${req.query.page || '1'}`],
  }),
  escrowController.listEscrows,
);

/**
 * @route  GET /api/v1/escrows/search
 * @desc   Full-text and filter-based escrow search.
 * @query  q           free-text search term (matched against addresses)
 * @query  status      single or comma-separated: Active,Completed,Disputed,Cancelled
 * @query  creator     exact client Stellar address
 * @query  arbitrator  exact arbitrator Stellar address
 * @query  dateFrom    ISO date — createdAt >= dateFrom
 * @query  dateTo      ISO date — createdAt <= dateTo
 * @query  minAmount   minimum totalAmount
 * @query  maxAmount   maximum totalAmount
 * @query  sortBy      createdAt | totalAmount | status  (default: createdAt)
 * @query  sortOrder   asc | desc  (default: desc)
 * @query  page        default 1
 * @query  limit       default 20, max 100
 */
router.get('/search', validatePagination, escrowController.searchEscrowsV1);

/**
 * @route  POST /api/escrows/broadcast
 * @desc   Submit a signed Soroban transaction (create, approve, release, dispute, cancel).
 *         Invalidates the escrows collection cache after a successful broadcast.
 *         If the request body contains an escrowId the corresponding detail cache entry
 *         is also purged so GET /escrows/:id reflects the new state immediately.
 */
router.post(
  '/broadcast',
  validateBroadcast,
  invalidateOn({
    tags: (req) => {
      const tags = ['escrows'];
      // Optionally scope per-escrow invalidation when the caller supplies escrowId
      const escrowId = req.body?.escrowId ?? req.query?.escrowId;
      if (escrowId) {
        const tenantId = req.tenant?.id ?? '_global';
        // Invalidate the custom key used by the detail cache
        tags.push(`escrow:${tenantId}:${escrowId}`);
        // Also invalidate the tag-based entries
        tags.push(`escrow:${escrowId}`);
      }
      return tags;
    },
  }),
  escrowController.broadcastCreateEscrow,
);

/**
 * @route  GET /api/escrows/:id/milestones
 */
router.get(
  '/:id/milestones',
  validateEscrowId,
  validatePagination,
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => [`escrow:${req.params.id}`, 'milestones'],
  }),
  escrowController.getMilestones,
);

/**
 * @route  GET /api/escrows/:id/milestones/:milestoneId
 */
router.get(
  '/:id/milestones/:milestoneId',
  validateEscrowId,
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => [
      `escrow:${req.params.id}`,
      `milestone:${req.params.id}:${req.params.milestoneId}`,
    ],
  }),
  escrowController.getMilestone,
);

/**
 * @route  GET /api/escrows/:id
 * @desc   Fetch a single escrow by ID.
 *
 * Caching strategy:
 *   - TTL:     30 seconds (CACHE_TTL_DETAIL env var or TTL.DETAIL default)
 *   - Key:     escrow:<tenantId>:<escrowId>  — tenant-scoped to prevent cross-tenant data leaks
 *   - Tags:    ['escrows', 'escrow:<id>']    — for tag-based bulk invalidation
 *   - X-Cache: HIT header is set on cached responses
 *
 * Invalidation:
 *   Cache is evicted when the escrow is mutated via POST /escrows/broadcast
 *   (covers create, approve_milestone, release_funds, raise_dispute, cancel).
 */
router.get(
  '/:id',
  validateEscrowId,
  cacheResponse({
    ttl: TTL.DETAIL, // 30 seconds (CACHE_TTL_DETAIL=30)
    keyFn: escrowDetailCacheKey,
    tags: (req) => ['escrows', `escrow:${req.params.id}`],
  }),
  escrowController.getEscrow,
);

export default router;
