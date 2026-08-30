import express from 'express';
import prisma from '../../lib/prisma.js';
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

// ── Shared middleware ─────────────────────────────────────────────────────────

/**
 * Loads a dispute by numeric `req.params.id` and attaches it to `req.dispute`.
 *
 * Null/undefined handling is standardized on strict equality (`=== null` /
 * `=== undefined`) throughout.  Prisma always returns `null` (never `undefined`)
 * for a missing record; an `undefined` `req.params.id` indicates a misconfigured
 * route — both produce a clear HTTP error rather than a downstream TypeError.
 *
 * Routes that already call `validateDisputeAccess` (from fileUpload middleware,
 * which sets its own `req.dispute`) do NOT need this middleware.
 */
const loadDispute = async (req, res, next) => {
  const rawId = req.params.id;

  // Standardized check: treat both null and undefined as a missing value
  if (rawId === null || rawId === undefined) {
    return res.status(400).json({ error: 'Dispute id is required' });
  }

  const id = parseInt(rawId, 10);

  // parseInt returns NaN for non-numeric strings; reject floats and negatives too
  if (Number.isNaN(id) || id < 1 || String(id) !== String(parseInt(rawId, 10))) {
    return res.status(400).json({ error: 'Dispute id must be a positive integer' });
  }

  try {
    const dispute = await prisma.dispute.findFirst({
      where: { id, tenantId: req.tenant.id },
      include: { escrow: true },
    });

    // Prisma returns null (not undefined) when no record matches — explicit check
    if (dispute === null) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    req.dispute = dispute;
    next();
  } catch (err) {
    next(err);
  }
};

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
  invalidateOn({ tags: (req) => [`dispute:${req.params.id}`, 'disputes'] }),
  // uploadEvidence already calls validateDisputeAccess which sets req.dispute
  disputeController.uploadEvidence,
  disputeController.postEvidence,
  handleUploadError,
);

router.get(
  '/:id/evidence',
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => [`dispute:${req.params.id}`],
  }),
  disputeController.listEvidence,
);

// ── Automated Resolution ──────────────────────────────────────────────────────

router.post(
  '/:id/resolve/auto',
  loadDispute,
  invalidateOn({
    tags: (req) => [`dispute:${req.params.id}`, `escrow:${req.params.id}`, 'disputes', 'escrows'],
  }),
  disputeController.autoResolve,
);

router.get(
  '/:id/resolve/recommendation',
  loadDispute,
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
  checkPermission(ROLES.ARBITRATOR, 'resolve_dispute'),
  requireMfa,
  loadDispute,
  invalidateOn({
    tags: (req) => [`dispute:${req.params.id}`, `escrow:${req.params.id}`, 'disputes', 'escrows'],
  }),
  disputeController.autoResolve,
);

// ── Appeals ───────────────────────────────────────────────────────────────────

router.post(
  '/:id/appeals',
  loadDispute,
  invalidateOn({ tags: (req) => [`dispute:${req.params.id}`, 'disputes'] }),
  disputeController.postAppeal,
);

router.patch(
  '/appeals/:appealId',
  requireMfa,
  invalidateOn({ tags: ['disputes'] }),
  disputeController.patchAppeal,
);

export default router;
