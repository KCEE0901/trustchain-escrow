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
 * Parse the configured alert email recipients into a clean list.
 * @param {string|undefined} raw - Raw comma-separated recipients value
 * @returns {string[]} Trimmed, non-empty recipient addresses
 */
const parseEmailRecipients = (raw) => {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((recipient) => recipient.trim())
    .filter((recipient) => recipient.length > 0);
};

/**
 * Validate alert email delivery configuration.
 *
 * Fails fast with an actionable, secret-free error when the email channel is
 * enabled but misconfigured, or when contradictory settings are present.
 *
 * @param {Object} [env=process.env] - Environment to validate
 * @returns {{ enabled: boolean, recipients: string[] }} Normalized config
 * @throws {Error} When the configuration is invalid
 */
export const validateAlertEmailConfig = (env = process.env) => {
  const enabled = env.ALERT_EMAIL_ENABLED === 'true';
  const recipients = parseEmailRecipients(env.ALERT_EMAIL_RECIPIENTS);

  if (!enabled) {
    if (recipients.length > 0) {
      throw new Error(
        'Invalid alert email configuration: ALERT_EMAIL_RECIPIENTS is set but ALERT_EMAIL_ENABLED is not "true". ' +
          'Set ALERT_EMAIL_ENABLED=true to enable email delivery or remove ALERT_EMAIL_RECIPIENTS.'
      );
    }
    return { enabled: false, recipients: [] };
  }

  if (recipients.length === 0) {
    throw new Error(
      'Invalid alert email configuration: ALERT_EMAIL_ENABLED is "true" but ALERT_EMAIL_RECIPIENTS is empty. ' +
        'Provide a comma-separated list of recipient addresses.'
    );
  }

  const invalidRecipients = recipients.filter(
    (recipient) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
  );
  if (invalidRecipients.length > 0) {
    throw new Error(
      `Invalid alert email configuration: ${invalidRecipients.length} recipient address(es) are malformed. ` +
        'Each ALERT_EMAIL_RECIPIENTS entry must be a valid email address.'
    );
  }

  return { enabled: true, recipients };
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
      const emailConfig = validateAlertEmailConfig();
      await emailAlert(alert, emailConfig);
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
 * @param {{ enabled: boolean, recipients: string[] }} [emailConfig] - Validated
 *   email configuration. When omitted it is validated from the environment.
 */
const emailAlert = async (alert, emailConfig) => {
  try {
    const config = emailConfig ?? validateAlertEmailConfig();
    if (!config.enabled) return;

    // TODO: Implement email sending
    // const emailService = await import('./emailService.js');
    // await emailService.sendAlert({
    //   to: config.recipients,
    //   subject: `[${alert.severity.toUpperCase()}] ${alert.type}`,
    //   body: formatEmailAlert(alert),
    // });

    console.log(
      `[Alert] Email alert would be sent for ${alert.type} to ${config.recipients.length} recipient(s)`
    );
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
 

/* … truncated 1638 chars — edit only what you need near the top … */
