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
  PERMANENT_EVENT_FAILURE: 'permanent_event_failure',
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
 * Track last sent alerts to prevent spam
 */
const lastAlerts = new Map();

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
 * @param {Object} alertData - Alert data. An optional `dedupeKey` scopes the
 *   cooldown to that key instead of the alert type, so distinct incidents of
 *   the same type are not suppressed by each other.
 * @returns {Promise<'sent'|'skipped'|'failed'>}
 */
const sendAlert = async (alertData) => {
  const { type, severity, message, metadata, dedupeKey } = alertData;
  const cooldownKey = dedupeKey ?? type;

  if (!shouldSendAlert(cooldownKey)) {
    console.log(`[Alert] Skipped ${type} alert due to cooldown`);
    return 'skipped';
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

    markAlertSent(cooldownKey);
    console.log(`[Alert] ${type} alert sent successfully`);
    return 'sent';
  } catch (error) {
    console.error('[Alert] Error sending alert:', error);
    return 'failed';
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

// ── Sync-lag samples and retention ───────────────────────────────────────────

/**
 * Bounds for the in-memory sync-lag history. Samples older than `MAX_AGE_MS`
 * or beyond the newest `MAX_SAMPLES` are dropped, so the history cannot grow
 * without limit however often the indexer reports.
 */
export const SYNC_LAG_RETENTION = Object.freeze({
  MAX_SAMPLES: 120, // one hour at the 30s monitoring interval
  MAX_AGE_MS: 60 * 60 * 1000, // 1 hour
  /** A sample older than this no longer describes the current lag. */
  STALE_AFTER_MS: 5 * 60 * 1000, // 5 minutes
});

const syncLagRetention = { ...SYNC_LAG_RETENTION };
let syncLagSamples = [];

const isNonNegativeNumber = (value) => Number.isFinite(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

/**
 * Override the retention bounds (all fields optional). Invalid values are
 * ignored and the current setting kept. Existing samples are pruned at once.
 *
 * @param {{ maxSamples?: number, maxAgeMs?: number, staleAfterMs?: number }} [options]
 * @returns {{ maxSamples: number, maxAgeMs: number, staleAfterMs: number }} effective settings
 */
const configureSyncLagRetention = ({ maxSamples, maxAgeMs, staleAfterMs } = {}) => {
  if (isPositiveInteger(maxSamples)) syncLagRetention.MAX_SAMPLES = maxSamples;
  if (isPositiveInteger(maxAgeMs)) syncLagRetention.MAX_AGE_MS = maxAgeMs;
  if (isPositiveInteger(staleAfterMs)) syncLagRetention.STALE_AFTER_MS = staleAfterMs;
  pruneSyncLagSamples();
  return getSyncLagRetention();
};

/** @returns {{ maxSamples: number, maxAgeMs: number, staleAfterMs: number }} */
const getSyncLagRetention = () => ({
  maxSamples: syncLagRetention.MAX_SAMPLES,
  maxAgeMs: syncLagRetention.MAX_AGE_MS,
  staleAfterMs: syncLagRetention.STALE_AFTER_MS,
});

/**
 * Record one observation of the indexer's position. Lag is the time between
 * the newest ledger on chain closing and the last processed ledger closing.
 * Only these numbers are kept: no event payloads, addresses or URLs.
 *
 * @param {Object} sample
 * @param {number} sample.latestLedger - newest ledger sequence on chain
 * @param {number} sample.processedLedger - last ledger sequence indexed
 * @param {number} sample.latestClosedAt - close time of latestLedger (ms epoch)
 * @param {number} sample.processedClosedAt - close time of processedLedger (ms epoch)
 * @param {number} [sample.observedAt=Date.now()] - when the sample was taken (ms epoch)
 * @returns {boolean} whether the sample was valid and stored
 */
const recordSyncLagSample = ({
  latestLedger,
  processedLedger,
  latestClosedAt,
  processedClosedAt,
  observedAt = Date.now(),
} = {}) => {
  if (
    !Number.isInteger(latestLedger) ||
    !Number.isInteger(processedLedger) ||
    latestLedger < 0 ||
    processedLedger < 0 ||
    processedLedger > latestLedger ||
    !isNonNegativeNumber(latestClosedAt) ||
    !isNonNegativeNumber(processedClosedAt) ||
    !isNonNegativeNumber(observedAt)
  ) {
    return false;
  }

  syncLagSamples.push({
    latestLedger,
    processedLedger,
    ledgersBehind: latestLedger - processedLedger,
    // A clock skew that puts the processed ledger "after" the latest one
    // means the indexer is caught up, not ahead.
    lagMs: Math.max(0, latestClosedAt - processedClosedAt),
    observedAt,
  });
  // Keep samples ordered by observation time, even if reports arrive late.
  syncLagSamples.sort((a, b) => a.observedAt - b.observedAt);
  pruneSyncLagSamples(observedAt);
  return true;
};

/**
 * Drop samples older than the retention window and beyond the sample cap.
 * Safe to call at any time; repeated calls are idempotent.
 *
 * @param {number} [now=Date.now()]
 * @returns {number} how many samples were removed
 */
const pruneSyncLagSamples = (now = Date.now()) => {
  const before = syncLagSamples.length;
  const cutoff = now - syncLagRetention.MAX_AGE_MS;
  let kept = syncLagSamples.filter((s) => s.observedAt >= cutoff);
  if (kept.length > syncLagRetention.MAX_SAMPLES) {
    kept = kept.slice(kept.length - syncLagRetention.MAX_SAMPLES);
  }
  syncLagSamples = kept;
  return before - kept.length;
};

/** Remove every stored sample. @returns {number} how many were removed */
const clearSyncLagSamples = () => {
  const removed = syncLagSamples.length;
  syncLagSamples = [];
  return removed;
};

/** @returns {Array<Object>} copies of the retained samples, oldest first */
const getSyncLagSamples = () => syncLagSamples.map((s) => ({ ...s }));

/**
 * Calculate sync lag between blockchain and database from the newest sample.
 * Returns 0 when there is no sample, or when the newest one is stale, so an
 * indexer that stopped reporting is not alerted on with an outdated value.
 *
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>} Sync lag in milliseconds
 */
const calculateSyncLag = async (now = Date.now()) => {
  pruneSyncLagSamples(now);
  const latest = syncLagSamples[syncLagSamples.length - 1];
  if (!latest || now - latest.observedAt > syncLagRetention.STALE_AFTER_MS) {
    return 0;
  }
  return latest.lagMs;
};

/**
 * Alert for Redis connection issues
 * @param {boolean} connected - Redis connection status
 */
export const alertRedisConnection = async (connected) => {
  if (!connected) {
    await sendAlert({
      type: ALERT_TYPES.REDIS_CONNECTION_LOST,
      severity: ALERT_SEVERITY.CRITICAL,
      message: 'Redis connection lost - queue processing will be affected',
      metadata: {
        connectionStatus: connected,
      },
    });
  }
};

/**
 * Alert for queue processing stopped
 * @param {number} waitingJobs - Number of waiting jobs
 * @param {number} activeJobs - Number of active jobs
 */
export const alertQueueProcessingStopped = async (waitingJobs, activeJobs) => {
  if (waitingJobs > 0 && activeJobs === 0) {
    await sendAlert({
      type: ALERT_TYPES.QUEUE_PROCESSING_STOPPED,
      severity: ALERT_SEVERITY.WARNING,
      message: `Queue has ${waitingJobs} waiting jobs but no active processing`,
      metadata: {
        waitingJobs,
        activeJobs,
      },
    });
  }
};

/**
 * Start the monitoring service
 */
export const startMonitoring = () => {
  // Monitor every 30 seconds
  setInterval(monitorQueueHealth, 30000);

  console.log('[Alert] Queue monitoring service started');
};

// Export for testing
export {
  sendAlert,
  shouldSendAlert,
  markAlertSent,
  consoleAlert,
  emailAlert,
  webhookAlert,
  monitoringSystemAlert,
  formatEmailAlert,
  calculateSyncLag,
  recordSyncLagSample,
  pruneSyncLagSamples,
  clearSyncLagSamples,
  getSyncLagSamples,
  configureSyncLagRetention,
  getSyncLagRetention,
};
