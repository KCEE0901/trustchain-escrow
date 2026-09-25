/**
 * Public Reputation Routes
 *
 * Handles public (no-auth) reputation lookups by Stellar address.
 * Mounted at /api/users so the endpoint resolves to:
 *   GET /api/users/:address/reputation
 *
 * Rate-limited at 60 req/min per IP to guard the public surface.
 */

import express from 'express';
import reputationController from '../controllers/reputationController.js';
import { createRateLimitMiddleware, RATE_LIMIT_WINDOW_MS } from '../../middleware/rateLimit.js';
import { stellarAddressParam, handleValidationErrors } from '../../middleware/validation.js';

const router = express.Router();

// 60 req/min per IP — in line with the issue requirement
const publicReputationRateLimit = createRateLimitMiddleware({
  max: 60,
  windowMs: RATE_LIMIT_WINDOW_MS,
  prefix: 'reputation-public',
  message: 'Too many reputation requests, please try again in a minute.',
});

const validateAddress = [stellarAddressParam('address'), handleValidationErrors];

/**
 * @route  GET /api/users/:address/reputation
 * @desc   Public endpoint — no authentication required.
 *         Returns the on-chain reputation record for a Stellar address.
 *         Reads from Redis cache first; falls back to the DB indexer record.
 * @param  address  Stellar address (G…56 chars)
 * @returns 200 { address, score, completedEscrows, disputeWins, disputeLosses, lastUpdated }
 * @returns 400 invalid Stellar address
 * @returns 404 no reputation record for that address
 * @returns 429 rate limit exceeded
 */
router.get(
  '/:address/reputation',
  validateAddress,
  publicReputationRateLimit,
  reputationController.getByAddress,
);

export default router;
