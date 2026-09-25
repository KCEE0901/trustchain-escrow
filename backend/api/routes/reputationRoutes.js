import express from 'express';
import reputationController from '../controllers/reputationController.js';
import { cacheResponse, TTL } from '../middleware/cache.js';
import { reputationSearchRateLimit, createRateLimitMiddleware, RATE_LIMIT_WINDOW_MS } from '../../middleware/rateLimit.js';

const router = express.Router();

// Public rate limiter: 60 req/min per IP for the unauthenticated reputation lookup.
const publicReputationRateLimit = createRateLimitMiddleware({
  max: 60,
  windowMs: RATE_LIMIT_WINDOW_MS,
  prefix: 'reputation-public',
  message: 'Too many reputation requests, please try again in a minute.',
});

/**
 * @route  GET /api/reputation/search?q=<prefix>
 * ES-backed address autocomplete + full-text search. Prisma fallback on outage.
 */
router.get('/search', reputationSearchRateLimit, reputationController.search);

/**
 * @route  GET /api/reputation/leaderboard
 */
router.get(
  '/leaderboard',
  cacheResponse({ ttl: TTL.LEADERBOARD, tags: ['reputation:leaderboard'] }),
  reputationController.getLeaderboard,
);

/**
 * @route  POST /api/reputation/admin/recalculate
 * Admin-only: recompute all scores from event history
 */
router.post('/admin/recalculate', reputationController.recalculate);

/**
 * @route  GET /api/reputation/:address
 */
router.get(
  '/:address',
  cacheResponse({
    ttl: TTL.REPUTATION,
    tags: (req) => ['reputation', `reputation:${req.params.address}`],
  }),
  reputationController.getReputation,
);

export { publicReputationRateLimit };
export default router;
