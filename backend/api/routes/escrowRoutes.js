import express from 'express';
import { idempotencyMiddleware } from '../../lib/idempotency.js';
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
 */
router.post(
  '/broadcast',
  validateBroadcast,
  idempotencyMiddleware,
  invalidateOn({ tags: ['escrows'] }),
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
 */
router.get(
  '/:id',
  validateEscrowId,
  cacheResponse({
    ttl: TTL.DETAIL,
    tags: (req) => ['escrows', `escrow:${req.params.id}`],
  }),
  escrowController.getEscrow,
);

/**
 * @route  POST /api/escrows/export
 * @desc   Queue an escrow data export
 */
router.post('/export', escrowController.queueEscrowExport);

/**
 * @route  GET /api/escrows/export/:jobId
 * @desc   Get escrow export status
 */
router.get('/export/:jobId', escrowController.getEscrowExportStatus);

/**
 * @route  POST /api/escrows/export/:jobId/cancel
 * @route  DELETE /api/escrows/export/:jobId
 * @desc   Cancel a queued or running escrow export
 */
router.post('/export/:jobId/cancel', escrowController.cancelEscrowExport);
router.delete('/export/:jobId', escrowController.cancelEscrowExport);

export default router;
