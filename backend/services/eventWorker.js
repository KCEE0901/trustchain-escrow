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
      entries.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    async claim(key, token, leaseMs) {
      if (live(key)) return false;
      entries.set(key, { value: `pending:${token}`, expiresAt: now() + leaseMs });
      return true;
    },
    async markSent(key, ttlMs) {
      entries.set(key, { value: 'sent', expiresAt: now() + ttlMs });
    },
    async release(key, token) {
      if (live(key)?.value === `pending:${token}`) entries.delete(key);
    },
  };
};

// Deletes the key only if it still holds this worker's claim token.
const RELEASE_IF_OWNER_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

/** Cross-process dedupe store backed by an ioredis client. */
export const createRedisAlertDedupeStore = (redis) => ({
  async claim(key, token, leaseMs) {
    const result = await redis.set(FAILURE_ALERT_KEY_PREFIX + key, `pending:${token}`, 'PX', leaseMs, 'NX');
    return result === 'OK';
  },
  async markSent(key, ttlMs) {
    await redis.set(FAILURE_ALERT_KEY_PREFIX + key, 'sent', 'PX', ttlMs);
  },
  async release(key, token) {
    await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, FAILURE_ALERT_KEY_PREFIX + key, `pending:${token}`);
  },
});

const defaultAlertDedupeStore = () =>
  connection && typeof connection.set === 'function' && typeof connection.eval === 'function'
    ? createRedisAlertDedupeStore(connection)
    : createMemoryAlertDedupeStore();

/** Default sender: routes through alertService, keyed per failure (not per type). */
const defaultFailureAlertSender = async (alert) => {
  const outcome = await sendAlert({
    type: ALERT_TYPES.PERMANENT_EVENT_FAILURE,
    severity: ALERT_SEVERITY.CRITICAL,
    message: `Stellar event permanently failed after ${alert.attemptsMade} attempts`,
    metadata: alert,
    dedupeKey: `${ALERT_TYPES.PERMANENT_EVENT_FAILURE}:${alert.alertKey}`,
  });
  if (outcome === 'failed') throw new Error('alert delivery failed');
};

let failureAlerting = { store: undefined, sender: defaultFailureAlertSender };

/**
 * Override the dedupe store and/or alert sender (tests, custom channels).
 * Call with no arguments to restore the defaults.
 */
export const configureFailureAlerting = ({ store, sender } = {}) => {
  failureAlerting = { store, sender: sender ?? defaultFailureAlertSender };
};

const alertDedupeStore = () => {
  if (!failureAlerting.store) failureAlerting.store = defaultAlertDedupeStore();
  return failureAlerting.store;
};

/**
 * Send the alert for a permanent failure at most once per failure key.
 *
 * @returns {Promise<'sent'|'duplicate'>}
 * @throws when delivery fails (after releasing the claim, so a retry can alert)
 */
export const sendPermanentFailureAlert = async ({ alertKey, originalJob, error, attemptsMade }) => {
  const store = alertDedupeStore();
  const token = randomUUID();

  let claimed;
  try {
    claimed = await store.claim(alertKey, token, FAILURE_ALERT_LEASE_MS);
  } catch {
    // If dedupe storage itself is down, prefer a possible duplicate alert
    // over silently dropping a permanent failure.
    console.warn(`[DeadLetter] Alert dedupe store unavailable for ${alertKey}; sending without dedupe`);
    claimed = true;
  }
  if (!claimed) {
    console.log(`[DeadLetter] Alert for ${alertKey} already sent or in flight; skipping`);
    return 'duplicate';
  }

  const alert = {
    alertKey,
    ledger: originalJob?.ledger ?? null,
    eventType: describeEventType(originalJob?.event),
    attemptsMade: attemptsMade ?? null,
    error: safeErrorMessage(error),
  };

  try {
    await failureAlerting.sender(alert);
  } catch (sendError) {
    await store.release(alertKey, token).catch(() => {});
    throw sendError;
  }
  await store.markSent(alertKey, FAILURE_ALERT_TTL_MS).catch(() => {
    console.warn(`[DeadLetter] Could not record alert ${alertKey} as sent`);
  });
  return 'sent';
};

/** Event type for alert metadata; never throws on malformed events. */
const describeEventType = (event) => {
  try {
    return parseEventType(event);
  } catch {
    return 'Unknown';
  }
};

/**
 * Processes a single Stellar event
 * @param {Object} job - BullMQ job containing event data
 */
const processStellarEvent = async (job) => {
  const { event, ledger } = job.data;

  try {
    queueMetrics.totalJobs++;

    // Update job progress
    await job.updateProgress(10);

    // Validate event data
    if (!event || !ledger) {
      throw new Error('Invalid event data: missing event or ledger information');
    }

    await job.updateProgress(25);

    // Route event to appropriate handler based on event type
    const eventType = parseEventType(event);

    await job.updateProgress(50);

    // Process the event (this would call the actual handler functions)
    await processEventByType(eventType, event, ledger);

    await job.updateProgress(75);

    // Update last processed ledger
    await updateLastProcessedLedger(ledger);

    await job.updateProgress(100);

    console.log(`[Worker] Successfully processed ${eventType} event from ledger ${ledger}`);
  } catch (error) {
    console.error(`[Worker] Error processing event:`, error);

    // Add context to the error for better debugging
    error.eventData = { event, ledger };
    error.timestamp = new Date().toISOString();

    throw error; // Re-throw to trigger BullMQ retry logic
  }
};

/**
 * Parses event type from Stellar event topic
 * @param {Object} event - Stellar event object
 * @returns {string} Event type
 */
const parseEventType = (event) => {
  if (!event.topic || !event.topic[0]) {
    throw new Error('Event missing topic information');
  }

  // Convert topic to readable event name
  const topicHex = event.topic[0];
  const eventMap = {
    '6573635f637274': 'EscrowCreated', // esc_crt
    '6d696c5f616464': 'MilestoneAdded', // mil_add
    '6d696c5f737562': 'MilestoneSubmitted', // mil_sub
    '6d696c5f617070': 'MilestoneApproved', // mil_app
    '66756e645f726c': 'FundsReleased', // fun_rl
    '6573635f63616e': 'EscrowCancelled', // esc_can
    '6469735f726169': 'DisputeRaised', // dis_rai
    '6469735f726573': 'DisputeResolved', // dis_res
    '7265705f757064': 'ReputationUpdated', // rep_upd
  };

  return eventMap[topicHex] || 'Unknown';
};

/**
 * Routes event to the appropriate handler function
 * @param {string} eventType - Type of event
 * @param {Object} event - Event data
 * @param {number} ledger - Ledger number
 */
const processEventByType = async (eventType, event, ledger) => {
  // Import handlers dynamically to avoid circular dependencies
  const {
    handleEscrowCreated,
    handleMilestoneAdded,
    handleMilestoneSubmitted,
    handleMilestoneApproved,
    handleFundsReleased,
    handleEscrowCancelled,
    handleDisputeRaised,
    handleDisputeResolved,
    handleReputationUpdated,
  } = await import('./escrowIndexer.js');

  switch (eventType) {
    case 'EscrowCreated':
      return await handleEscrowCreated(event);
    case 'MilestoneAdded':
      return await handleMilestoneAdded(event);
    case 'MilestoneSubmitted':
      return await handleMilestoneSubmitted(event);
    case 'MilestoneApproved':
      return await handleMilestoneApproved(event);
    case 'FundsReleased':
      return await handleFundsReleased(event);
    case 'EscrowCancelled':
      return await handleEscrowCancelled(event);
    case 'DisputeRaised':
      return await handleDisputeRaised(event);
    case 'DisputeResolved':
      return await handleDisputeResolved(event);
    case 'ReputationUpdated':
      return await handleReputationUpdated(event);
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
};

/**
 * Updates the last processed ledger in the database
 * @param {number} ledger - Ledger number
 */
const updateLastProcessedLedger = async (ledger) => {
  try {
    // TODO: Implement database update
    // await prisma.indexerState.upsert({
    //   where: { id: 1 },
    //   update: { lastProcessedLedger: ledger },
    //   create: { id: 1, lastProcessedLedger: ledger },
    // });

    console.log(`[Worker] Updated last processed ledger to ${ledger}`);
  } catch (error) {
    console.error('[Worker] Error updating last processed ledger:', error);
    throw error;
  }
};

/**
 * Dead letter queue processor for handling permanently failed events
 */
const processDeadLetterEvent = async (job) => {
  const { originalJob, error, attemptsMade } = job.data;
  const alertKey = job.data.alertKey ?? failureAlertKey(originalJob);

  console.error(
    `[DeadLetter] Processing permanently failed job ${alertKey} after ${attemptsMade} attempts: ${safeErrorMessage(error)}`,
  );

  try {
    // Log the failure for manual investigation
    await logPermanentFailure(originalJob, error, attemptsMade);

    // Alert at most once per failure, across retries and concurrent workers.
    const outcome = await sendPermanentFailureAlert({ alertKey, originalJob, error, attemptsMade });

    console.log(`[DeadLetter] Permanent failure ${alertKey} handled (alert ${outcome})`);
    return outcome;
  } catch (logError) {
    console.error(`[DeadLetter] Error processing dead letter job ${alertKey}: ${safeErrorMessage(logError)}`);
    throw logError;
  }
};

/**
 * `failed` handler for the main worker: on the final attempt, enqueue exactly
 * one dead-letter job per failure (deterministic `jobId`), so repeated
 * `failed` emissions or re-enqueued events cannot create duplicates.
 */
const handleEventJobFailed = async (job, err) => {
  if (!job) return undefined;
  console.error(`[Worker] Job ${job.id} failed:`, err?.message);

  // Move to dead letter queue after max attempts
  if (!(job.attemptsMade >= job.opts?.attempts)) return undefined;

  const alertKey = failureAlertKey(job.data);
  try {
    return await deadLetterQueue.add(
      'dead-letter-event',
      {
        originalJob: job.data,
        error: {
          message: err?.message,
          stack: err?.stack,
        },
        attemptsMade: job.attemptsMade,
        originalJobId: job.id,
        alertKey,
      },
      { jobId: deadLetterJobId(alertKey) },
    );
  } catch (enqueueError) {
    console.error(
      `[Worker] Could not move job ${job.id} to dead letter queue (${alertKey}): ${safeErrorMessage(enqueueError)}`,
    );
    return undefined;
  }
};

/**
 * Logs permanent failures to database for investigation
 * @param {Object} originalJob - Original job data
 * @param {Error} error - Error that caused failure
 * @param {number} attemptsMade - Number of retry attempts
 */
const logPermanentFailure = async (originalJob, error, attemptsMade) => {
  try {
    // TODO: Implement database logging
    // await prisma.permanentFailure.create({
    //   data: {
    //     eventData: originalJob.data,
    //     errorMessage: error.message,
    //     errorStack: error.stack,
    //     attemptsMade,
    //     failedAt: new Date(),
    //   }
    // });

    console.log('[DeadLetter] Permanent failure logged successfully');
  } catch (logError) {
    console.error('[DeadLetter] Error logging permanent failure:', logError);
    throw logError;
  }
};

/**
 * Create and configure the main event processing worker
 */
export const createEventWorker = () => {
  const worker = new Worker('stellar-events', processStellarEvent, {
    connection,
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
    limiter: {
      max: 100,
      duration: 60000, // 100 jobs per minute
    },
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    void handleEventJobFailed(job, err);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
  });

  return worker;
};

/**
 * Create and configure the dead letter queue worker
 */
export const createDeadLetterWorker = () => {
  const worker = new Worker('stellar-events-dead-letter', processDeadLetterEvent, {
    connection,
    concurrency: 2, // Lower concurrency for dead letter processing
  });

  worker.on('completed', (job) => {
    console.log(`[DeadLetter] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DeadLetter] Job ${job.id} failed:`, err);
  });

  worker.on('error', (err) => {
    console.error('[DeadLetter] Worker error:', err);
  });

  return worker;
};

// Export functions for testing
export {
  processStellarEvent,
  parseEventType,
  processEventByType,
  updateLastProcessedLedger,
  processDeadLetterEvent,
  logPermanentFailure,
  handleEventJobFailed,
};
