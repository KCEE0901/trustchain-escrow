import express from 'express';
import disputeController from '../controllers/disputeController.js';
import { cacheResponse, invalidateOn, TTL } from '../middleware/cache.js';
import authMiddleware from '../middleware/auth.js';
import { requireMfa } from '../middleware/mfaAuth.js';
import { checkPermission, ROLES } from '../middleware/roleGuard.js';
import { handleUploadError } from '../middleware/fileUpload.js';
import {
  validate,
  disputeListQueryRules,
  disputeEscrowIdParamRules,
} from '../middleware/validation.js';

const router = express.Router();
router.use(authMiddleware);

// ── Shared guard: require a non-empty :id param ───────────────────────────────
//
// Standardised null/undefined check: all param presence guards in this file
// use `=== null || === undefined` (or its shorthand `=== null`/`=== undefined`)
// exclusively — never `== null`, `!value`, or truthy checks — so the behaviour
// is predictable for values such as `0` or `""`.
//
function requireId(paramName = 'id') {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (value === null || value === undefined || value === '') {
      return res.status(400).json({
        error: 'Validation failed',
        details: [{ field: paramName, message: `${paramName} param is required`, location: 'params' }],
      });
    }
    return next();
  };
}

// ── List / Get ────────────────────────────────────────────────────────────────

router.get(
  '/',
  validate(disputeListQueryRules),
  cacheResponse({ ttl: TTL.LIST, tags: ['disputes'] }),
  disputeController.listDisputes,
);

router.get(
  '/history',
  cacheResponse({ ttl: TTL.LIST, tags: ['disputes', 'disputes:history'] }),
  disputeController.getResolutionHistory,
);

router.get(
  '/:escrowId',
  validate(disputeEscrowIdParamRules),
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => ['disputes', `dispute:${req.params.escrowId}`],
  }),
  disputeController.getDispute,
);

// ── Evidence ──────────────────────────────────────────────────────────────────

router.post(
  '/:id/evidence',
  requireId('id'),
  invalidateOn({ tags: (req) => [`dispute:${req.params.id}`, 'disputes'] }),
  disputeController.uploadEvidence,
  disputeController.postEvidence,
  handleUploadError,
);

router.get(
  '/:id/evidence',
  requireId('id'),
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => [`dispute:${req.params.id}`],
  }),
  disputeController.listEvidence,
);

// ── Automated Resolution ──────────────────────────────────────────────────────

router.post(
  '/:id/resolve/auto',
  requireId('id'),
  invalidateOn({
    tags: (req) => [`dispute:${req.params.id}`, `escrow:${req.params.id}`, 'disputes', 'escrows'],
  }),
  disputeController.autoResolve,
);

router.get(
  '/:id/resolve/recommendation',
  requireId('id'),
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => [`dispute:${req.params.id}`],
  }),
  disputeController.getRecommendation,
);

// ── Arbiter Resolution (requires 2FA for Arbitrator and Admin roles) ──────────

/**
 * POST /api/disputes/:id/resolve
 * Arbiter-initiated manual dispute resolution.
 * Requires MFA verification to prevent unauthorized resolutions.
 */
router.post(
  '/:id/resolve',
  requireId('id'),
  checkPermission(ROLES.ARBITRATOR, 'resolve_dispute'),
  requireMfa,
  invalidateOn({
    tags: (req) => [`dispute:${req.params.id}`, `escrow:${req.params.id}`, 'disputes', 'escrows'],
  }),
  disputeController.autoResolve,
);

// ── Appeals ───────────────────────────────────────────────────────────────────

router.post(
  '/:id/appeals',
  requireId('id'),
  invalidateOn({ tags: (req) => [`dispute:${req.params.id}`, 'disputes'] }),
  disputeController.postAppeal,
);

router.patch(
  '/appeals/:appealId',
  requireId('appealId'),
  requireMfa,
  invalidateOn({ tags: ['disputes'] }),
  disputeController.patchAppeal,
);

export default router;
