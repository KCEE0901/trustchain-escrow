import express from 'express';
import paymentController from '../controllers/paymentController.js';
import {
  stellarAddressParam,
  stellarAddressBody,
  handleValidationErrors,
} from '../../middleware/validation.js';
import authMiddleware from '../middleware/auth.js';
import { authorizeBodyAddress, authorizeParamAddress } from '../middleware/authorization.js';

const router = express.Router();

/**
 * Accessibility contract for clients rendering these payment endpoints.
 *
 * Every route below is consumed by icon-only controls in the frontend
 * payment UI (checkout button, refund action, status refresh, close/dismiss
 * icons on toasts and modals). None of these routes render markup
 * themselves — this file is pure Express routing/JSON — but the response
 * shape is documented here so consuming components know which field to use
 * as the accessible label instead of leaving an icon-only control unlabeled.
 *
 * Consuming components MUST set `aria-label` (or `aria-labelledby`) on any
 * icon-only button/link that triggers one of these routes:
 *
 *   - POST /checkout            -> aria-label="Pay with card" (or similar,
 *                                   describing the checkout action, not just
 *                                   "Pay")
 *   - GET  /status/:sessionId   -> aria-label="Refresh payment status"
 *   - GET  /:address            -> aria-label="View payment history"
 *   - POST /:paymentId/refund   -> aria-label="Refund payment" — this is a
 *                                   destructive/financial action, so the
 *                                   label should be unambiguous and paired
 *                                   with a visible confirmation step.
 *
 * See ACCESSIBILITY_PAYMENTS.md at the repo root for the full audit of
 * icon-only controls in the payment flow and their fixes.
 */

const captureRawBody = (req, _res, next) => {
  let data = '';
  req.on('data', (chunk) => (data += chunk));
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
};

router.post('/webhook', captureRawBody, express.json(), paymentController.webhook);

/**
 * @route  POST /api/payments/checkout
 * @body   { address: string, amountUsd: number, escrowId?: string }
 * @desc   Create a Stripe Checkout session. Requires KYC Approved status.
 */
router.post(
  '/checkout',
  authMiddleware,
  stellarAddressBody('address'),
  handleValidationErrors,
  authorizeBodyAddress('address'),
  paymentController.createCheckout,
);

/**
 * @route  GET /api/payments/status/:sessionId
 * @desc   Get payment record by Stripe session ID.
 */
router.get('/status/:sessionId', authMiddleware, paymentController.getStatus);

/**
 * @route  GET /api/payments/:address
 * @desc   List all payments for a Stellar address.
 */
router.get(
  '/:address',
  authMiddleware,
  stellarAddressParam('address'),
  handleValidationErrors,
  authorizeParamAddress('address'),
  paymentController.listByAddress,
);

/**
 * @route  POST /api/payments/:paymentId/refund
 * @desc   Issue a full refund for a completed payment.
 */
router.post('/:paymentId/refund', authMiddleware, paymentController.refund);

export default router;
