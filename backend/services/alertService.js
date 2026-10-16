/**
 * Alert Service for Queue Monitoring
 *
 * Monitors queue health and sends alerts when thresholds are exceeded.
 * Supports multiple alert channels including console, email, and webhooks.
 *
 * @module alertService
 */

import { queueMetrics } from '../lib/queueConfig.js';

/**
 * Alert severity levels
 */
export const ALERT_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

/**
 * Alert types
 */
export const ALERT_TYPES = {
  HIGH_FAILURE_RATE: 'high_failure_rate',
  REDIS_CONNECTION_LOST: 'redis_connection_lost',
  QUEUE_PROCESSING_STOPPED: 'queue_processing_stopped',
  DEAD_LETTER_QUEUE_FULL: 'dead_letter_queue_full',
  MEMORY_USAGE_HIGH: 'memory_usage_high',
  SYNC_LAG_HIGH: 'sync_lag_high',
};

/**
 * Alert configuration
 */
const ALERT_CONFIG = {
  FAILURE_RATE_THRESHOLD: 5.0, // 5%
  DEAD_LETTER_THRESHOLD: 100, // 100 jobs in dead letter queue
  MEMORY_USAGE_THRESHOLD: 90, // 90% memory usage
  SYNC_LAG_THRESHOLD: 30000, // 30 seconds in milliseconds
  ALERT_COOLDOWN: 300000, // 5 minutes between same alert type
};

/**
 * Bounded telemetry configuration for sync-lag calculation.
 * Keeps emitted metric values within a deterministic, non-sensitive range.
 */
const SYNC_LAG_TELEMETRY = {
  MAX_LAG_MS: 86400000, // clamp reported lag to 24h to keep metrics bounded
  MAX_LEDGER: 1000000000, // clamp ledger numbers to a sane upper bound
};

/**
 * Track last sent alerts to prevent spam
 */
const lastAlerts = new Map();

/**
 * Clamp a numeric value into a bounded, finite range.
 * @param {number} value - Raw value
 * @param {number} max - Upper bound
 * @returns {number} Bounded non-negative integer
 */
const clampBounded = (value, max) => {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
};

/**
 * Emit a bounded, structured telemetry metric for sync-lag calculation.
 * Values are clamped and contain no sensitive data.
 * @param {string} outcome - Deterministic outcome label
 * @param {Object} [fields] - Bounded numeric fields
 */
const emitSyncLagMetric = (outcome, fields = {}) => {
  const metric = {
    metric: 'indexer.sync_lag',
    outcome,
    ...fields,
  };
  console.log(`[Metric] ${JSON.stringify(metric)}`);
};

/**
 * Emit a correlated, secret-free log line for sync-lag calculation.
 * @param {string} level - Log level
 * @param {string} outcome - Deterministic outcome label
 * @param {Object} [fields] - Bounded numeric fields
 */
const logSyncLag = (level, outcome, fields = {}) => {
  const entry = {
    event: 'indexer.sync_lag',
    outcome,
    ...fields,
  };
  const line = `[Alert] ${JSON.stringify(entry)}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

/**
 * Check if an alert should be sent (cooldown period)
 * @param {string} alertType - Type of alert
 * @returns {boolean} Whether alert should be sent
 */
const shouldSendAlert = (alertType) => {
  const lastSent = lastAlerts.get(alertType);
  if (!lastSent) return true;

  const timeSinceLastAlert = Date.now() - lastSent;
  return timeSinceLastAlert > ALERT_CONFIG.ALERT_COOLDOWN;
};

/**
 * Mark alert as sent
 * @param {string} alertType - Type of alert
 */
const markAlertSent = (alertType) => {
  lastAlerts.set(alertType, Date.now());
};

/**
 * Send alert to all configured channels
 * @param {Object} alertData - Alert data
 */
const sendAlert = async (alertData) => {
  const { type, severity, message, metadata } = alertData;

  if (!shouldSendAlert(type)) {
    console.log(`[Alert] Skipped ${type} alert due to cooldown`);
    return;
  }

  const timestamp = new Date().toISOString();
  const alert = {
    type,
    severity,
    message,
    metadata,
    timestamp,
    service: 'stellar-event-queue',
  };

  try {
    // Send to console (always)
    consoleAlert(alert);

    // Send to email if configured
    if (process.env.ALERT_EMAIL_ENABLED === 'true') {
      await emailAlert(alert);
    }

    // Send to webhook if configured
    if (process.env.ALERT_WEBHOOK_URL) {
      await webhookAlert(alert);
    }

    // Send to monitoring system if configured
    if (process.env.MONITORING_SYSTEM_ENABLED === 'true') {
      await monitoringSystemAlert(alert);
    }

    markAlertSent(type);
    console.log(`[Alert] ${type} alert sent successfully`);
  } catch (error) {
    console.error('[Alert] Error sending alert:', error);
  }
};

/**
 * Console alert handler
 * @param {Object} alert - Alert data
 */
const consoleAlert = (alert) => {
  const emoji = {
    [ALERT_SEVERITY.INFO]: 'ℹ️',
    [ALERT_SEVERITY.WARNING]: '⚠️',
    [ALERT_SEVERITY.ERROR]: '❌',
    [ALERT_SEVERITY.CRITICAL]: '🚨',
  };

  console.log(`${emoji[alert.severity]} [ALERT] ${alert.type.toUpperCase()}: ${alert.message}`);
  console.log(`[ALERT] Timestamp: ${alert.timestamp}`);
  if (alert.metadata) {
    console.log(`[ALERT] Metadata:`, JSON.stringify(alert.metadata, null, 2));
  }
  console.log('---');
};

/**
 * Email alert handler
 * @param {Object} alert - Alert data
 */
const emailAlert = async (alert) => {
  try {
    // TODO: Implement email sending
    // const emailService = await import('./emailService.js');
    // await emailService.sendAlert({
    //   to: process.env.ALERT_EMAIL_RECIPIENTS?.split(','),
    //   subject: `[${alert.severity.toUpperCase()}] ${alert.type}`,
    //   body: formatEmailAlert(alert),
    // });

    console.log(`[Alert] Email alert would be sent for ${alert.type}`);
  } catch (error) {
    console.error('[Alert] Error sending email alert:', error);
  }
};

/**
 * Webhook alert handler
 * @param {Object} alert - Alert data
 */
const webhookAlert = async (alert) => {
  try {
    const response = await fetch(process.env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(alert),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with ${response.status}`);
    }

    console.log(`[Alert] Webhook alert sent successfully for ${alert.type}`);
  } catch (error) {
    console.error('[Alert] Error sending webhook alert:', error);
  }
};

/**
 * Monitoring system alert handler
 * @param {Object} alert - Alert data
 */
const monitoringSystemAlert = async (alert) => {
  try {
    // TODO: Implement monitoring system integration
    // Could integrate with Prometheus, Datadog, New Relic, etc.
    console.log(`[Alert] Monitoring system alert would be sent for ${alert.type}`);
  } catch (error) {
    console.error('[Alert] Error sending monitoring system alert:', error);
  }
};

/**
 * Format alert for email
 * @param {Object} alert - Alert data
 * @returns {string} Formatted email content
 */
const formatEmailAlert = (alert) => {
  return `
Alert: ${alert.type}
Severity: ${alert.severity}
Message: ${alert.message}
Timestamp: ${alert.timestamp}
Service: ${alert.service}

Metadata:
${JSON.stringify(alert.metadata, null, 2)}

---
This alert was generated by the Stellar Event Queue Monitoring System.
  `.trim();
};

/**
 * Monitor queue health and send alerts as needed
 */
export const monitorQueueHealth = async () => {
  try {
    const failureRate = queueMetrics.getFailureRate();
    const successRate = queueMetrics.getSuccessRate();
    const deadLetterCount = queueMetrics.deadLetterCount;

    // Check failure rate
    if (failureRate > ALERT_CONFIG.FAILURE_RATE_THRESHOLD) {
      await sendAlert({
        type: ALERT_TYPES.HIGH_FAILURE_RATE,
        severity: failureRate > 10 ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
        message: `High failure rate detected: ${failureRate.toFixed(2)}% (${queueMetrics.failedJobs}/${queueMetrics.totalJobs} jobs)`,
        metadata: {
          failureRate,
          successRate,
          totalJobs: queueMetrics.totalJobs,
          failedJobs: queueMetrics.failedJobs,
          threshold: ALERT_CONFIG.FAILURE_RATE_THRESHOLD,
        },
      });
    }

    // Check dead letter queue size
    if (deadLetterCount > ALERT_CONFIG.DEAD_LETTER_THRESHOLD) {
      await sendAlert({
        type: ALERT_TYPES.DEAD_LETTER_QUEUE_FULL,
        severity: deadLetterCount > 500 ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
        message: `Dead letter queue has ${deadLetterCount} jobs (threshold: ${ALERT_CONFIG.DEAD_LETTER_THRESHOLD})`,
        metadata: {
          deadLetterCount,
          threshold: ALERT_CONFIG.DEAD_LETTER_THRESHOLD,
        },
      });
    }

    // Check sync lag (would need to be calculated from event timestamps)
    const syncLag = await calculateSyncLag();
    if (syncLag > ALERT_CONFIG.SYNC_LAG_THRESHOLD) {
      await sendAlert({
        type: ALERT_TYPES.SYNC_LAG_HIGH,
        severity: syncLag > 60000 ? ALERT_SEVERITY.ERROR : ALERT_SEVERITY.WARNING,
        message: `Index sync lag is ${(syncLag / 1000).toFixed(1)} seconds (threshold: ${ALERT_CONFIG.SYNC_LAG_THRESHOLD / 1000}s)`,
        metadata: {
          syncLag,
          threshold: ALERT_CONFIG.SYNC_LAG_THRESHOLD,
        },
      });
    }
  } catch (error) {
    console.error('[Alert] Error monitoring queue health:', error);
  }
};

/**
 * Calculate sync lag between blockchain and database
 *
 * Emits bounded structured telemetry and correlated, secret-free logs for the
 * primary success path and failure/boundary paths (missing or zero last-indexed
 * ledger, stale/negative lag, and RPC/query failure).
 *
 * @returns {number} Sync lag in milliseconds (0 when unavailable)
 */
const calculateSyncLag = async () => {
  let latestLedger;
  let lastIndexedLedger;

  try {
    latestLedger = await getLatestLedger();
    lastIndexedLedger = await getLastIndexedLedger();
  } catch (error) {
    // Failure path: RPC/query error. Log a deterministic, secret-free message.
    logSyncLag('error', 'query_failure', {
      errorName: error && error.name ? String(error.name) : 'Error',
    });
    emitSyncLagMetric('query_failure', { lagMs: 0 });
    return 0;
  }

  // Boundary path: missing or zero last-indexed ledger.
  if (!Number.isFinite(lastIndexedLedger) || lastIndexedLedger <= 0) {
    logSyncLag('warn', 'missing_last_indexed', {
      latestLedger: clampBounded(latestLedger, SYNC_LAG_TELEMETRY.MAX_LEDGER),
    });
    emitSyncLagMetric('missing_last_indexed', { lagMs: 0 });
    return 0;
  }

  // Boundary path: negative or stale lag (indexer ahead of chain head).
  const rawLag = (latestLedger - lastIndexedLedger) * 1000;
  if (!Number.isFinite(rawLag) || rawLag < 0) {
    logSyncLag('warn', 'negative_lag', {
      latestLedger: clampBounded(latestLedger, SYNC_LAG_TELEMETRY.MAX_LEDGER),
      lastIndexedLedger: clampBounded(lastIndexedLedger, SYNC_LAG_TELEMETRY.MAX_LEDGER),
    });
    emitSyncLagMetric('negative_lag', { lagMs: 0 });
    return 0;
  }

  // Primary success path: bounded lag value.
  const syncLag = clampBounded(rawLag, SYNC_LAG_TELEMETRY.MAX_LAG_MS);
  logSyncLag('info', 'success', {
    lagMs: syncLag,
    latestLedger: clampBounded(latestLedger, SYNC_LAG_TELEMETRY.MAX_LEDGER),
    lastIndexedLedger: clampBounded(lastIndexedLedger, SYNC_LAG_TELEMETRY.MAX_LEDGER),
  });
  emitSyncLagMetric('success', { lagMs: syncLag });
  return syncLag;
};

/**
 * Fetch the latest blockchain ledger height.
 * @returns {Promise<number>} Latest ledger number
 */
const getLatestLedger = async () => {
  // TODO: Implement by querying the blockchain RPC for the latest ledger.
  return 0;
};

/**
 * Fetch the last processed ledger height from the database.
 * @returns {Promise<number>} Last indexed ledger number
 */
const getLastIndexedLedger = async () => {
  // TODO: Implement by querying the database for the last processed ledger.
  return 0;
};

/**
 * Alert for Redis connection issues
 * @param {boolean} connected - Redis connection status
 */
export const alertRedisConnection = async (connected) => {
 

/* … truncated 1252 chars — edit only what you need near the top … */
