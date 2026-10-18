/**
 * Stellar Event Processing Worker
 *
 * Handles processing of Stellar events from the queue with automatic retry logic
 * and dead letter queue handling for permanent failures.
 *
 * @module eventWorker
 */

import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import {
  connection,
  stellarEventsQueue,
  deadLetterQueue,
  queueMetrics,
} from '../lib/queueConfig.js';
import { sendAlert, ALERT_SEVERITY, ALERT_TYPES } from './alertService.js';

// ── Persistence configuration validation ──────────────────────────────────────
//
// The worker persists dead-letter entries and alert-dedupe markers. Invalid or
// contradictory persistence settings must fail fast at startup with an
// actionable, deterministic message that never echoes secret values.

/** Defaults for the persistence-related runtime settings. */
export const PERSISTENCE_DEFAULTS = Object.freeze({
  maxAttempts: 5,
  deadLetterRetentionMs: 7 * 24 * 60 * 60 * 1000,
  alertDedupeTtlMs: 7 * 24 * 60 * 60 * 1000,
  alertDedupeLeaseMs: 60 * 1000,
});

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

/**
 * Validate event worker persistence configuration.
 *
 * @param {Object} [config] - persistence settings (defaults applied per field)
 * @param {number} [config.maxAttempts] - attempts before dead-lettering
 * @param {number} [config.deadLetterRetentionMs] - dead-letter retention window
 * @param {number} [config.alertDedupeTtlMs] - "sent" marker lifetime
 * @param {number} [config.alertDedupeLeaseMs] - in-flight claim lease
 * @param {boolean} [config.redisAvailable] - whether a Redis client is present
 * @returns {Object} normalized configuration
 * @throws {Error} with a deterministic, secret-free message on invalid input
 */
export const validatePersistenceConfig = (config = {}) => {
  const resolved = {
    maxAttempts: config.maxAttempts ?? PERSISTENCE_DEFAULTS.maxAttempts,
    deadLetterRetentionMs:
      config.deadLetterRetentionMs ?? PERSISTENCE_DEFAULTS.deadLetterRetentionMs,
    alertDedupeTtlMs: config.alertDedupeTtlMs ?? PERSISTENCE_DEFAULTS.alertDedupeTtlMs,
    alertDedupeLeaseMs: config.alertDedupeLeaseMs ?? PERSISTENCE_DEFAULTS.alertDedupeLeaseMs,
    redisAvailable: config.redisAvailable ?? true,
  };

  if (!isPositiveInteger(resolved.maxAttempts)) {
    throw new Error(
      `Invalid event worker persistence config: maxAttempts must be a positive integer (received ${describeValue(resolved.maxAttempts)})`,
    );
  }
  if (!isPositiveInteger(resolved.deadLetterRetentionMs)) {
    throw new Error(
      `Invalid event worker persistence config: deadLetterRetentionMs must be a positive integer (received ${describeValue(resolved.deadLetterRetentionMs)})`,
    );
  }
  if (!isPositiveInteger(resolved.alertDedupeTtlMs)) {
    throw new Error(
      `Invalid event worker persistence config: alertDedupeTtlMs must be a positive integer (received ${describeValue(resolved.alertDedupeTtlMs)})`,
    );
  }
  if (!isPositiveInteger(resolved.alertDedupeLeaseMs)) {
    throw new Error(
      `Invalid event worker persistence config: alertDedupeLeaseMs must be a positive integer (received ${describeValue(resolved.alertDedupeLeaseMs)})`,
    );
  }
  if (resolved.alertDedupeLeaseMs >= resolved.alertDedupeTtlMs) {
    throw new Error(
      'Invalid event worker persistence config: alertDedupeLeaseMs must be less than alertDedupeTtlMs',
    );
  }
  if (typeof resolved.redisAvailable !== 'boolean') {
    throw new Error(
      `Invalid event worker persistence config: redisAvailable must be a boolean (received ${describeValue(resolved.redisAvailable)})`,
    );
  }

  return resolved;
};

/** Deterministic, secret-free description of an invalid value. */
const describeValue = (value) => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value;
};

/**
 * Read persistence settings from the environment and validate them.
 * Only non-secret numeric/boolean settings are read; connection strings are
 * never inspected or logged.
 *
 * @param {Object} [env] - environment source (defaults to process.env)
 * @returns {Object} normalized configuration
 */
export const loadPersistenceConfig = (env = process.env) => {
  const parseNumber = (raw) => {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  };
  return validatePersistenceConfig({
    maxAttempts: parseNumber(env.EVENT_WORKER_MAX_ATTEMPTS),
    deadLetterRetentionMs: parseNumber(env.EVENT_WORKER_DLQ_RETENTION_MS),
    alertDedupeTtlMs: parseNumber(env.EVENT_WORKER_ALERT_TTL_MS),
    alertDedupeLeaseMs: parseNumber(env.EVENT_WORKER_ALERT_LEASE_MS),
    redisAvailable:
      connection && typeof connection.set === 'function' && typeof connection.eval === 'function',
  });
};

// ── Failure alerting configuration validation ─────────────────────────────────
//
// Failure alerting is opt-in. When enabled it requires a webhook URL and a
// positive failure threshold; contradictory or malformed settings must fail
// fast at startup with an actionable, deterministic message. Webhook URLs are
// treated as secrets and are never echoed in error messages or logs.

/** Defaults for the failure-alerting runtime settings. */
export const ALERTING_DEFAULTS = Object.freeze({
  enabled: false,
  failureThreshold: 1,
});

const isHttpUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * Validate event worker failure-alerting configuration.
 *
 * @param {Object} [config] - alerting settings (defaults applied per field)
 * @param {boolean} [config.enabled] - whether failure alerting is active
 * @param {string} [config.webhookUrl] - alert delivery webhook (secret)
 * @param {number} [config.failureThreshold] - consecutive failures before alerting
 * @returns {Object} normalized configuration
 * @throws {Error} with a deterministic, secret-free message on invalid input
 */
export const validateAlertingConfig = (config = {}) => {
  const resolved = {
    enabled: config.enabled ?? ALERTING_DEFAULTS.enabled,
    webhookUrl: config.webhookUrl,
    failureThreshold: config.failureThreshold ?? ALERTING_DEFAULTS.failureThreshold,
  };

  if (typeof resolved.enabled !== 'boolean') {
    throw new Error(
      `Invalid event worker alerting config: enabled must be a boolean (received ${describeValue(resolved.enabled)})`,
    );
  }
  if (!isPositiveInteger(resolved.failureThreshold)) {
    throw new Error(
      `Invalid event worker alerting config: failureThreshold must be a positive integer (received ${describeValue(resolved.failureThreshold)})`,
    );
  }

  if (resolved.enabled) {
    if (resolved.webhookUrl === undefined || resolved.webhookUrl === null || resolved.webhookUrl === '') {
      throw new Error(
        'Invalid event worker alerting config: webhookUrl is required when alerting is enabled',
      );
    }
    if (!isHttpUrl(resolved.webhookUrl)) {
      throw new Error(
        'Invalid event worker alerting config: webhookUrl must be a valid http(s) URL',
      );
    }
  } else if (resolved.webhookUrl !== undefined && resolved.webhookUrl !== null && resolved.webhookUrl !== '') {
    if (!isHttpUrl(resolved.webhookUrl)) {
      throw new Error(
        'Invalid event worker alerting config: webhookUrl must be a valid http(s) URL',
      );
    }
  }

  return resolved;
};

/**
 * Read failure-alerting settings from the environment and validate them.
 * The webhook URL is read but never logged; only its presence is validated.
 *
 * @param {Object} [env] - environment source (defaults to process.env)
 * @returns {Object} normalized configuration
 */
export const loadAlertingConfig = (env = process.env) => {
  const parseBoolean = (raw) => {
    if (raw === undefined || raw === '') return undefined;
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return raw;
  };
  const parseNumber = (raw) => {
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  };
  return validateAlertingConfig({
    enabled: parseBoolean(env.EVENT_WORKER_ALERTING_ENABLED),
    webhookUrl: env.EVENT_WORKER_ALERT_WEBHOOK_URL,
    failureThreshold: parseNumber(env.EVENT_WORKER_ALERT_FAILURE_THRESHOLD),
  });
};

// ── Failure alerting idempotency ───────────────────────────────────────────────
//
// A permanently failed event must produce exactly one dead-letter job and one
// alert, even when BullMQ re-emits `failed`, a dead-letter job is retried, or
// two workers handle the same failure concurrently. Every failure gets a
// deterministic key derived from the event itself (not from job ids, which
// change when the same event is re-enqueued):
//
//  1. the dead-letter job is added with `jobId` derived from that key, so
//     BullMQ ignores duplicate adds while the job exists, and
//  2. the alert is sent only after atomically claiming the key in a dedupe
//     store (Redis `SET NX` in production). A claim is a short lease while the
//     alert is in flight and becomes a long-lived "sent" marker on success; a
//     failed send releases it so a retry can alert.

/** How long a "sent" marker suppresses repeat alerts for the same failure. */
export const FAILURE_ALERT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long an in-flight claim blocks other workers before it can be retaken. */
export const FAILURE_ALERT_LEASE_MS = 60 * 1000;
const FAILURE_ALERT_KEY_PREFIX = 'trustchain:alerts:event-failure:';
const MAX_ALERT_ERROR_LENGTH = 300;

/** JSON with recursively sorted keys, so equal payloads hash identically. */
const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * Deterministic identity of a permanent failure: a hash of the original job
 * payload (event + ledger). The same event always maps to the same key.
 * Contains only hex characters, so it is also a valid BullMQ custom job id.
 * @param {Object} originalJobData - `job.data` of the failed stellar-events job
 * @returns {string}
 */
export const failureAlertKey = (originalJobData) =>
  createHash('sha256')
    .update(stableStringify(originalJobData ?? null))
    .digest('hex')
    .slice(0, 32);

/** BullMQ job id for the dead-letter entry of a failure (no `:` allowed). */
export const deadLetterJobId = (alertKey) => `dlq-${alertKey}`;

/** First line of the error message, truncated; never the stack or payload. */
const safeErrorMessage = (error) => {
  const message = typeof error?.message === 'string' ? error.message : String(error ?? 'unknown');
  const firstLine = message.split('\n')[0];
  return firstLine.length > MAX_ALERT_ERROR_LENGTH
    ? `${firstLine.slice(0, MAX_ALERT_ERROR_LENGTH)}…`
    : firstLine;
};

/** Process-local dedupe store; used when no Redis client is available. */
export const createMemoryAlertDedupeStore = (now = () => Date.now()) => {
  const entries = new Map();
  const live = (key) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) {
      entries.delete(key)

/* … truncated 4546 chars — edit only what you need near the top … */
