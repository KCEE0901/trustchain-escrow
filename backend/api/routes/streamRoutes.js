/**
 * Stream Routes
 *
 * Server-Sent Events (SSE) endpoint for real-time escrow and payment status
 * updates. Sends a loading indicator while connecting and transitions to live
 * data once the subscription is established.
 *
 * GET /api/stream/escrows   — stream escrow status change events
 * GET /api/stream/payments  — stream payment status change events
 */
import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';

const router = Router();

/** How often (ms) to emit a keepalive comment so proxies don't time out. */
const KEEPALIVE_INTERVAL_MS = parseInt(
  process.env.SSE_KEEPALIVE_INTERVAL_MS || '25000',
  10,
);

/**
 * Set standard SSE response headers and send the initial loading-state event.
 * Returns a cleanup function that the route must call when the connection closes.
 */
function initSseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
  res.flushHeaders();

  // ── Loading state ──────────────────────────────────────────────────────────
  // Sent immediately so the client can render a skeleton / spinner while the
  // server establishes its subscription. Matches the loading patterns used in
  // the frontend (e.g. EscrowCardSkeleton, DataTableSkeleton).
  sendSseEvent(res, 'loading', { status: 'connecting' });

  // ── Keepalive ──────────────────────────────────────────────────────────────
  const keepaliveTimer = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, KEEPALIVE_INTERVAL_MS);

  return function cleanup() {
    clearInterval(keepaliveTimer);
  };
}

/**
 * Write a single SSE event frame to the response.
 * @param {import('express').Response} res
 * @param {string} eventType
 * @param {object} data
 */
function sendSseEvent(res, eventType, data) {
  if (res.writableEnded) return;
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * @openapi
 * /api/stream/escrows:
 *   get:
 *     tags: [Stream]
 *     summary: Live escrow status stream (SSE)
 *     description: >
 *       Opens a Server-Sent Events connection. Emits a `loading` event
 *       immediately, then `escrow_update` events whenever an escrow's
 *       status changes for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SSE stream opened
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/escrows', authMiddleware, (req, res) => {
  const cleanup = initSseStream(res);

  // Notify the client that the stream is ready (loading → connected)
  sendSseEvent(res, 'connected', {
    status: 'connected',
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
  });

  // Wire up the real-time escrow event emitter (if available)
  const { escrowEmitter } = req.app.locals ?? {};
  const onEscrowUpdate = (update) => {
    if (!req.user || update.userId !== req.user.id) return;
    sendSseEvent(res, 'escrow_update', update);
  };

  if (escrowEmitter) {
    escrowEmitter.on('update', onEscrowUpdate);
  }

  req.on('close', () => {
    if (escrowEmitter) escrowEmitter.off('update', onEscrowUpdate);
    cleanup();
    if (!res.writableEnded) res.end();
  });
});

/**
 * @openapi
 * /api/stream/payments:
 *   get:
 *     tags: [Stream]
 *     summary: Live payment status stream (SSE)
 *     description: >
 *       Opens a Server-Sent Events connection. Emits a `loading` event
 *       immediately, then `payment_update` events whenever a payment
 *       status changes for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SSE stream opened
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/payments', authMiddleware, (req, res) => {
  const cleanup = initSseStream(res);

  sendSseEvent(res, 'connected', {
    status: 'connected',
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
  });

  const { paymentEmitter } = req.app.locals ?? {};
  const onPaymentUpdate = (update) => {
    if (!req.user || update.userId !== req.user.id) return;
    sendSseEvent(res, 'payment_update', update);
  };

  if (paymentEmitter) {
    paymentEmitter.on('update', onPaymentUpdate);
  }

  req.on('close', () => {
    if (paymentEmitter) paymentEmitter.off('update', onPaymentUpdate);
    cleanup();
    if (!res.writableEnded) res.end();
  });
});

export { sendSseEvent, initSseStream };
export default router;
