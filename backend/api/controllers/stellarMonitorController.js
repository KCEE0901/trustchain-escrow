/**
 * Stellar Monitor Controller
 *
 * API endpoints for the Stellar transaction monitoring service.
 * All endpoints require authentication and live under /api/v1/stellar-monitor.
 */

import { logControllerError } from '../../config/logger.js';
import {
  recordTransaction,
  getMonitorStatus,
  getRecentTransactions,
  getReviewNeededTransactions,
} from '../../services/stellarMonitorService.js';

/**
 * In-memory SLA metrics for webhook delivery latency.
 *
 * Tracks the time from source event ingestion to webhook delivery success,
 * broken down into queue wait and delivery duration. Kept intentionally
 * lightweight so it can be observed by tests and scraped by monitoring.
 */
const webhookSlaMetrics = {
  observations: 0,
  queueWaitMs: { count: 0, total: 0, max: 0 },
  deliveryMs: { count: 0, total: 0, max: 0 },
  totalMs: { count: 0, total: 0, max: 0 },
};

const toFiniteMs = (value) => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/**
 * Record a single webhook delivery SLA observation.
 *
 * @param {object} observation
 * @param {number} observation.ingestedAt - epoch ms when the source event was ingested
 * @param {number} observation.queuedAt - epoch ms when the webhook was enqueued
 * @param {number} observation.deliveredAt - epoch ms when delivery succeeded
 * @returns {object|null} the recorded sample, or null when timestamps are invalid
 */
export const observeWebhookDelivery = ({ ingestedAt, queuedAt, deliveredAt } = {}) => {
  const ingested = toFiniteMs(ingestedAt);
  const queued = toFiniteMs(queuedAt);
  const delivered = toFiniteMs(deliveredAt);

  if (ingested === null || queued === null || delivered === null) {
    return null;
  }

  const queueWaitMs = Math.max(0, queued - ingested);
  const deliveryMs = Math.max(0, delivered - queued);
  const totalMs = Math.max(0, delivered - ingested);

  webhookSlaMetrics.observations += 1;
  for (const [bucket, value] of [
    [webhookSlaMetrics.queueWaitMs, queueWaitMs],
    [webhookSlaMetrics.deliveryMs, deliveryMs],
    [webhookSlaMetrics.totalMs, totalMs],
  ]) {
    bucket.count += 1;
    bucket.total += value;
    bucket.max = Math.max(bucket.max, value);
  }

  return { queueWaitMs, deliveryMs, totalMs };
};

/**
 * Snapshot the current webhook delivery SLA metrics.
 * Averages are returned in milliseconds (0 when no observations exist).
 */
export const getWebhookSlaMetrics = () => {
  const summarize = (bucket) => ({
    count: bucket.count,
    totalMs: bucket.total,
    maxMs: bucket.max,
    avgMs: bucket.count > 0 ? bucket.total / bucket.count : 0,
  });

  return {
    observations: webhookSlaMetrics.observations,
    queueWait: summarize(webhookSlaMetrics.queueWaitMs),
    delivery: summarize(webhookSlaMetrics.deliveryMs),
    total: summarize(webhookSlaMetrics.totalMs),
  };
};

/**
 * GET /api/v1/stellar-monitor/status
 * Returns the current monitoring service status and transaction counts.
 */
const getStatus = async (req, res) => {
  try {
    const status = await getMonitorStatus();
    res.json({ data: status });
  } catch (err) {
    logControllerError('stellarMonitor.getStatus', err, req);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

/**
 * GET /api/v1/stellar-monitor/sla
 * Returns webhook delivery latency SLA metrics (queue wait + delivery duration).
 */
const getSlaMetrics = async (req, res) => {
  try {
    res.json({ data: getWebhookSlaMetrics() });
  } catch (err) {
    logControllerError('stellarMonitor.getSlaMetrics', err, req);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

/**
 * POST /api/v1/stellar-monitor/transactions
 * Register a new transaction for monitoring.
 */
const trackTransaction = async (req, res) => {
  try {
    const { txHash, fromAddress, toAddress, amount, memo, escrowId } = req.body;

    if (!txHash || typeof txHash !== 'string') {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'txHash is required' },
      });
    }
    if (!fromAddress || typeof fromAddress !== 'string') {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'fromAddress is required' },
      });
    }

    const record = await recordTransaction({ txHash, fromAddress, toAddress, amount, memo, escrowId });
    res.status(201).json({ data: record });
  } catch (err) {
    logControllerError('stellarMonitor.trackTransaction', err, req);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

/**
 * GET /api/v1/stellar-monitor/transactions
 * List recent monitored transactions with optional status filter.
 */
const listTransactions = async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const result = await getRecentTransactions({ status, page, limit });
    res.json(result);
  } catch (err) {
    logControllerError('stellarMonitor.listTransactions', err, req);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

/**
 * GET /api/v1/stellar-monitor/review
 * Admin-only: list transactions requiring manual review (stuck pending or ambiguous failure).
 */
const listReviewNeeded = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await getReviewNeededTransactions({ page, limit });
    res.json(result);
  } catch (err) {
    logControllerError('stellarMonitor.listReviewNeeded', err, req);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
};

export default {
  getStatus,
  getSlaMetrics,
  trackTransaction,
  listTransactions,
  listReviewNeeded,
};
