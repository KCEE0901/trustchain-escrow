/**
 * Stream Routes
 *
 * Server-Sent Events (SSE) endpoints for clients that cannot use the
 * WebSocket gateway (e.g. dashboards behind proxies that strip the
 * `Upgrade` header). Streams poll ContractEvent rows and push new
 * activity to connected clients as `text/event-stream`.
 *
 * GET /api/stream/health           — heartbeat-only stream, useful for probing
 *                                     that SSE works end-to-end through a proxy
 * GET /api/stream/escrow/:escrowId — live events for a single escrow
 *
 * All tunables are read from environment variables so operators can tune
 * connection limits and polling cadence per deployment without a code
 * change — see backend/.env.example for defaults and descriptions.
 *
 * @module routes/streamRoutes
 */

import express from 'express';
import prisma from '../../lib/prisma.js';
import authMiddleware from '../middleware/auth.js';
import { createModuleLogger } from '../../config/logger.js';

const log = createModuleLogger('streamRoutes');
const router = express.Router();

// ── Configuration (see backend/.env.example) ───────────────────────────────────

/** How often (ms) a heartbeat comment is sent to keep the connection alive through proxies/load balancers. */
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.STREAM_HEARTBEAT_INTERVAL_MS || '15000', 10);

/** How often (ms) the escrow stream polls the database for new ContractEvent rows. */
const POLL_INTERVAL_MS = parseInt(process.env.STREAM_POLL_INTERVAL_MS || '3000', 10);

/** Maximum number of SSE connections accepted concurrently, to bound DB polling load. */
const MAX_CONNECTIONS = parseInt(process.env.STREAM_MAX_CONNECTIONS || '200', 10);

/** Number of most-recent events replayed immediately on connect, before live polling begins. */
const BACKLOG_LIMIT = parseInt(process.env.STREAM_BACKLOG_LIMIT || '20', 10);

/** Whether `/api/stream/escrow/:escrowId` requires a valid session (defaults to required). */
const REQUIRE_AUTH = (process.env.STREAM_REQUIRE_AUTH ?? 'true') !== 'false';

/** Origin allowed to open the stream via CORS; falls back to the app-wide setting. */
const CORS_ORIGIN = process.env.STREAM_CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '*';

let activeConnections = 0;

function sseHeaders(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'X-Accel-Buffering': 'no', // disable nginx buffering so events flush immediately
  });
  res.flushHeaders?.();
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function serializeEvent(row) {
  return {
    id: row.id,
    eventType: row.eventType,
    escrowId: row.escrowId != null ? String(row.escrowId) : null,
    ledger: String(row.ledger),
    ledgerAt: row.ledgerAt,
    data: row.data,
    txHash: row.txHash,
  };
}

/**
 * @route  GET /api/stream/health
 * @desc   Heartbeat-only SSE stream for verifying SSE connectivity through
 *         proxies/load balancers without touching the database.
 */
router.get('/health', (req, res) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    return res.status(503).json({ error: 'Stream capacity reached. Try again shortly.' });
  }

  activeConnections++;
  sseHeaders(res);
  sendEvent(res, 'connected', { ok: true, at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    activeConnections--;
  });
});

/**
 * @route  GET /api/stream/escrow/:escrowId
 * @desc   Live-tails ContractEvent rows for a single escrow, replaying the
 *         most recent BACKLOG_LIMIT events on connect and then polling for
 *         new rows every POLL_INTERVAL_MS.
 */
router.get('/escrow/:escrowId', REQUIRE_AUTH ? authMiddleware : (_req, _res, next) => next(), async (req, res) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    return res.status(503).json({ error: 'Stream capacity reached. Try again shortly.' });
  }

  let escrowId;
  try {
    escrowId = BigInt(req.params.escrowId);
  } catch {
    return res.status(400).json({ error: 'escrowId must be numeric.' });
  }

  activeConnections++;
  sseHeaders(res);

  let lastId = 0;
  try {
    const backlog = await prisma.contractEvent.findMany({
      where: { escrowId },
      orderBy: { id: 'desc' },
      take: BACKLOG_LIMIT,
    });
    backlog.reverse().forEach((row) => sendEvent(res, 'escrow_event', serializeEvent(row)));
    lastId = backlog.length ? backlog[backlog.length - 1].id : 0;
  } catch (err) {
    log.error({ msg: 'stream_backlog_failed', escrowId: String(escrowId), err: err.message });
  }

  const poll = setInterval(async () => {
    try {
      const rows = await prisma.contractEvent.findMany({
        where: { escrowId, id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        sendEvent(res, 'escrow_event', serializeEvent(row));
        lastId = row.id;
      }
    } catch (err) {
      log.error({ msg: 'stream_poll_failed', escrowId: String(escrowId), err: err.message });
    }
  }, POLL_INTERVAL_MS);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(poll);
    clearInterval(heartbeat);
    activeConnections--;
  });
});

export default router;
