/**
 * Stellar Event Processing Worker
 *
 * Handles processing of Stellar events from the queue with automatic retry logic
 * and dead letter queue handling for permanent failures.
 *
 * @module eventWorker
 */

import { Worker } from 'bullmq';
import {
  connection,
  stellarEventsQueue,
  deadLetterQueue,
  queueMetrics,
} from '../lib/queueConfig.js';

/**
 * Tracks in-flight failure alerts so overlapping workers cannot emit
 * duplicate alerts for the same job. Keyed by job id.
 */
const inFlightFailureAlerts = new Map();

/**
 * Default retention bounds for persisted failure-alert records.
 * Bounds the operational data so long-running workers cannot grow unbounded.
 */
export const DEFAULT_ALERT_RETENTION = {
  maxEntries: 500,
  maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Persisted failure-alert records, bounded by count and age. Entries are
 * stored oldest-first so pruning is deterministic.
 */
const failureAlertRetention = [];

/**
 * Removes expired and excess failure-alert records. Deterministic: prunes by
 * age first, then by count, always dropping the oldest entries.
 *
 * @param {Object} [options]
 * @param {number} [options.maxEntries] - Maximum retained records
 * @param {number} [options.maxAgeMs] - Maximum record age in milliseconds
 * @param {number} [options.now] - Current timestamp (injectable for tests)
 * @returns {number} Number of records pruned
 */
export const pruneFailureAlerts = ({
  maxEntries = DEFAULT_ALERT_RETENTION.maxEntries,
  maxAgeMs = DEFAULT_ALERT_RETENTION.maxAgeMs,
  now = Date.now(),
} = {}) => {
  const before = failureAlertRetention.length;

  // Drop records older than the retention window (oldest-first ordering).
  while (
    failureAlertRetention.length > 0 &&
    now - failureAlertRetention[0].recordedAt > maxAgeMs
  ) {
    failureAlertRetention.shift();
  }

  // Drop excess records beyond the count bound, oldest first.
  while (failureAlertRetention.length > maxEntries) {
    failureAlertRetention.shift();
  }

  return before - failureAlertRetention.length;
};

/**
 * Records a failure alert within the retention bounds. Returns the retained
 * record, or null when the record was rejected as invalid.
 *
 * @param {Object} alert - Failure alert payload
 * @param {number} [now] - Current timestamp (injectable for tests)
 * @returns {Object|null} The retained record
 */
export const recordFailureAlert = (alert, now = Date.now()) => {
  if (!alert || alert.jobId === undefined || alert.jobId === null) {
    return null;
  }

  const record = { ...alert, recordedAt: now };
  failureAlertRetention.push(record);
  pruneFailureAlerts({ now });
  return record;
};

/**
 * Returns a snapshot of currently retained failure-alert records.
 *
 * @returns {Array<Object>} Retained records (oldest first)
 */
export const getRetainedFailureAlerts = () => failureAlertRetention.slice();

/**
 * Optional alerting transport. When unset (or when the transport throws),
 * failure alerting degrades gracefully instead of propagating errors.
 *
 * @returns {Object|null} The configured transport, or null when unavailable.
 */
const getAlertTransport = () => {
  const transport = globalThis.__alertTransport;
  if (!transport || typeof transport.sendAlert !== 'function') {
    return null;
  }
  return transport;
};

/**
 * Emits a failure alert for a permanently failed event job.
 *
 * Concurrency-safe: overlapping workers racing on the same job id will
 * observe a single deterministic alert. The first caller wins; subsequent
 * callers receive `{ emitted: false, reason: 'duplicate' }`.
 *
 * Gracefully degrades when optional alerting infrastructure is unavailable:
 * a missing transport, a transport error, or a transport timeout all resolve
 * to a stable `{ emitted: false, reason }` response rather than throwing.
 *
 * @param {Object} params
 * @param {string|number} params.jobId - Identifier of the failed job
 * @param {Object} params.originalJob - Original job data
 * @param {Error|Object} params.error - Error that caused the failure
 * @param {number} params.attemptsMade - Number of retry attempts
 * @returns {Promise<{emitted: boolean, reason?: string}>}
 */
export const emitFailureAlert = async ({ jobId, originalJob, error, attemptsMade }) => {
  if (jobId === undefined || jobId === null) {
    throw new Error('emitFailureAlert requires a jobId');
  }

  if (inFlightFailureAlerts.has(jobId)) {
    return { emitted: false, reason: 'duplicate' };
  }

  // Reserve the slot synchronously before any await so concurrent callers
  // deterministically observe the reservation.
  inFlightFailureAlerts.set(jobId, true);

  try {
    const alert = {
      type: 'PERMANENT_EVENT_FAILURE',
      jobId,
      attemptsMade,
      errorMessage: error && error.message ? error.message : String(error),
      failedAt: new Date().toISOString(),
      eventData: originalJob && originalJob.data ? originalJob.data : null,
    };

    const transport = getAlertTransport();

    // Degraded path: optional alerting infrastructure is not configured.
    if (!transport) {
      console.error(
        '[DeadLetter] Failure alert transport unavailable; degrading gracefully:',
        JSON.stringify({ jobId, attemptsMade }),
      );
      return { emitted: false, reason: 'transport_unavailable' };
    }

    try {
      await transport.sendAlert(alert);
    } catch (transportError) {
      // Degraded path: transport failed or timed out. Never propagate.
      console.error(
        '[DeadLetter] Failure alert transport error; degrading gracefully:',
        JSON.stringify({
          jobId,
          attemptsMade,
          reason: transportError && transportError.message
            ? transportError.message
            : String(transportError),
        }),
      );
      return { emitted: false, reason: 'transport_error' };
    }

    // Persist within retention bounds so operational data stays bounded.
    recordFailureAlert(alert);

    console.error('[DeadLetter] Failure alert emitted:', JSON.stringify(alert));

    return { emitted: true };
  } finally {
    inFlightFailureAlerts.delete(jobId);
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

  try {
    console.log(`[DeadLetter] Processing failed job ${job.id}`);

    // Emit failure alert (bounded, concurrency-safe, degrades gracefully)
    await emitFailureAlert({
      jobId: job.id,
      originalJob,
      error,
      attemptsMade,
    });

    // TODO: Implement dead letter handling logic
    // - Store failed event for manual review
    // - Send notifications to administrators
    // - Attempt recovery if possible

    console.log(`[DeadLetter] Processed failed job ${job.id}`);
  } catch (error) {
    console.error(`[DeadLetter] Error processing dead letter job:`, error);
    throw error;
  }
};

/**
 * Creates and starts the event worker
 * @returns {Worker} The BullMQ worker instance
 */
export const startEventWorker = () => {
  const worker = new Worker('stellar-events', processStellarEvent, {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
  });

  return worker;
};

/**
 * Creates and starts the dead letter queue worker
 * @returns {Worker} The BullMQ worker instance
 */
export const startDeadLetterWorker = () => {
  const worker = new Worker('dead-letter', processDeadLetterEvent, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job) => {
    console.log(`[DeadLetter] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DeadLetter] Job ${job.id} failed:`, err.message);
  });

  return worker;
};

export {
  processStellarEvent,
  processDeadLetterEvent,
  parseEventType,
  processEventByType,
  updateLastProcessedLedger,
};
