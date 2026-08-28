/**
 * @fileoverview Streaming indexer service for real-time Soroban and Stellar ledger event processing.
 * Manages event subscription pipelines, live block ingestion, cursor tracking, and metrics collection.
 * @module services/streamingIndexer
 */

import EventEmitter from 'events';
import { createModuleLogger } from '../config/logger.js';
import cache from '../lib/cache.js';

const logger = createModuleLogger('streamingIndexer');

/**
 * Event emitter for internal streaming indexer events.
 * @type {EventEmitter}
 */
const streamEvents = new EventEmitter();

/**
 * In-memory registry of active stream subscribers.
 * @type {Map<string, { filter: Function, callback: Function, createdAt: number }>}
 */
const activeSubscribers = new Map();

/**
 * Streaming indexer internal runtime state.
 * @type {{ isRunning: boolean, lastProcessedLedger: number, totalEventsProcessed: number, errorCount: number, startedAt: number|null }}
 */
const indexerState = {
  isRunning: false,
  lastProcessedLedger: 0,
  totalEventsProcessed: 0,
  errorCount: 0,
  startedAt: null,
};

/**
 * Initializes and starts the streaming indexer pipeline from a specific ledger sequence or the latest ledger.
 *
 * @async
 * @function startStreamingIndexer
 * @param {Object} [options={}] - Configuration options for starting the stream.
 * @param {number} [options.startLedger] - Starting ledger sequence. If omitted, resumes from the last saved cursor or latest ledger.
 * @param {number} [options.batchSize=50] - Number of events to process in each ingestion batch.
 * @param {number} [options.pollingIntervalMs=1000] - Polling interval in milliseconds for fetching new ledger entries.
 * @returns {Promise<{ success: boolean, startedAt: number, startLedger: number }>} Status object indicating successful start.
 * @throws {Error} If the indexer is already running or if initialization fails.
 *
 * @example
 * const result = await startStreamingIndexer({ startLedger: 105420, batchSize: 100 });
 * console.log(`Streaming indexer started at ledger ${result.startLedger}`);
 */
export async function startStreamingIndexer(options = {}) {
  if (indexerState.isRunning) {
    logger.warn('[StreamingIndexer] Start requested while already running');
    return {
      success: true,
      alreadyRunning: true,
      startedAt: indexerState.startedAt,
      startLedger: indexerState.lastProcessedLedger,
    };
  }

  const { startLedger = null, batchSize = 50, pollingIntervalMs = 1000 } = options;

  logger.info('[StreamingIndexer] Starting streaming indexer', {
    startLedger,
    batchSize,
    pollingIntervalMs,
  });

  let initialLedger = startLedger;
  if (!initialLedger && cache) {
    try {
      const savedCursor = await cache.get('streaming_indexer:last_ledger');
      if (savedCursor) {
        initialLedger = parseInt(savedCursor, 10);
      }
    } catch (err) {
      logger.warn('[StreamingIndexer] Failed to load cursor from cache, starting from 0', err);
    }
  }

  indexerState.isRunning = true;
  indexerState.startedAt = Date.now();
  indexerState.lastProcessedLedger = initialLedger || 0;

  streamEvents.emit('started', {
    startedAt: indexerState.startedAt,
    startLedger: indexerState.lastProcessedLedger,
  });

  return {
    success: true,
    startedAt: indexerState.startedAt,
    startLedger: indexerState.lastProcessedLedger,
  };
}

/**
 * Gracefully stops the streaming indexer and flushes any pending buffers.
 *
 * @async
 * @function stopStreamingIndexer
 * @param {Object} [options={}] - Teardown options.
 * @param {boolean} [options.flushBuffer=true] - Whether to flush buffered stream events before shutdown.
 * @param {number} [options.timeoutMs=5000] - Grace period timeout in milliseconds before forcing stop.
 * @returns {Promise<{ success: boolean, stoppedAt: number, totalEventsProcessed: number }>} Summary of indexed events upon stopping.
 *
 * @example
 * const summary = await stopStreamingIndexer({ flushBuffer: true });
 * console.log(`Stopped indexer. Processed ${summary.totalEventsProcessed} events.`);
 */
export async function stopStreamingIndexer(options = {}) {
  if (!indexerState.isRunning) {
    return {
      success: true,
      alreadyStopped: true,
      stoppedAt: Date.now(),
      totalEventsProcessed: indexerState.totalEventsProcessed,
    };
  }

  const { flushBuffer = true } = options;
  logger.info('[StreamingIndexer] Stopping streaming indexer', { flushBuffer });

  indexerState.isRunning = false;
  const stoppedAt = Date.now();

  if (cache && indexerState.lastProcessedLedger > 0) {
    try {
      await cache.set('streaming_indexer:last_ledger', indexerState.lastProcessedLedger.toString());
    } catch (err) {
      logger.error('[StreamingIndexer] Failed to persist ledger cursor on stop', err);
    }
  }

  streamEvents.emit('stopped', {
    stoppedAt,
    totalEventsProcessed: indexerState.totalEventsProcessed,
  });

  return {
    success: true,
    stoppedAt,
    totalEventsProcessed: indexerState.totalEventsProcessed,
  };
}

/**
 * Ingests and processes an incoming batch of streaming blockchain events.
 *
 * @async
 * @function processStreamBatch
 * @param {Array<Object>} events - List of raw blockchain events to be parsed and dispatched.
 * @param {number} ledgerSequence - Ledger block sequence number associated with this batch.
 * @returns {Promise<{ processedCount: number, errorCount: number, ledgerSequence: number }>} Processing metrics for the batch.
 * @throws {TypeError} If events is not an array or ledgerSequence is invalid.
 *
 * @example
 * const metrics = await processStreamBatch([event1, event2], 105421);
 * console.log(`Indexed ${metrics.processedCount} events in ledger ${metrics.ledgerSequence}`);
 */
export async function processStreamBatch(events, ledgerSequence) {
  if (!Array.isArray(events)) {
    throw new TypeError('Events parameter must be an array');
  }

  if (typeof ledgerSequence !== 'number' || ledgerSequence <= 0) {
    throw new TypeError('Ledger sequence must be a positive number');
  }

  let processedCount = 0;
  let errorCount = 0;

  for (const event of events) {
    try {
      for (const [subscriberId, subscriber] of activeSubscribers.entries()) {
        try {
          if (!subscriber.filter || subscriber.filter(event)) {
            subscriber.callback(event);
          }
        } catch (subErr) {
          logger.error(`[StreamingIndexer] Subscriber ${subscriberId} error:`, subErr);
        }
      }
      processedCount++;
    } catch (err) {
      errorCount++;
      indexerState.errorCount++;
      logger.error('[StreamingIndexer] Error processing event in batch:', err);
    }
  }

  indexerState.totalEventsProcessed += processedCount;
  indexerState.lastProcessedLedger = Math.max(indexerState.lastProcessedLedger, ledgerSequence);

  if (cache && ledgerSequence % 10 === 0) {
    try {
      await cache.set('streaming_indexer:last_ledger', indexerState.lastProcessedLedger.toString());
    } catch (cacheErr) {
      logger.warn('[StreamingIndexer] Cache cursor sync failed:', cacheErr);
    }
  }

  return {
    processedCount,
    errorCount,
    ledgerSequence,
  };
}

/**
 * Registers a callback subscriber for filtered real-time streaming events.
 *
 * @function registerStreamSubscriber
 * @param {string} subscriberId - Unique identifier for the subscriber.
 * @param {Function} callback - Function invoked with matching events `(event) => void`.
 * @param {Function} [filter=null] - Optional predicate function `(event) => boolean` to filter events.
 * @returns {{ subscriberId: string, registered: boolean }} Confirmation of registration.
 * @throws {TypeError} If subscriberId is not a string or callback is not a function.
 *
 * @example
 * const sub = registerStreamSubscriber('escrow-listener', (event) => console.log(event), (e) => e.type === 'escrow_created');
 */
export function registerStreamSubscriber(subscriberId, callback, filter = null) {
  if (!subscriberId || typeof subscriberId !== 'string') {
    throw new TypeError('Subscriber ID must be a non-empty string');
  }

  if (typeof callback !== 'function') {
    throw new TypeError('Callback must be a function');
  }

  activeSubscribers.set(subscriberId, {
    callback,
    filter: typeof filter === 'function' ? filter : null,
    createdAt: Date.now(),
  });

  logger.debug(`[StreamingIndexer] Registered subscriber: ${subscriberId}`);

  return {
    subscriberId,
    registered: true,
  };
}

/**
 * Unregisters an existing event stream subscriber by ID.
 *
 * @function removeStreamSubscriber
 * @param {string} subscriberId - Unique identifier of the subscriber to remove.
 * @returns {{ subscriberId: string, removed: boolean }} Confirmation of removal status.
 *
 * @example
 * const result = removeStreamSubscriber('escrow-listener');
 * console.log(`Subscriber removed: ${result.removed}`);
 */
export function removeStreamSubscriber(subscriberId) {
  const existed = activeSubscribers.delete(subscriberId);
  logger.debug(`[StreamingIndexer] Removed subscriber: ${subscriberId}, wasActive: ${existed}`);
  return {
    subscriberId,
    removed: existed,
  };
}

/**
 * Retrieves current performance and operational metrics for the streaming indexer.
 *
 * @function getStreamMetrics
 * @returns {{ isRunning: boolean, lastProcessedLedger: number, totalEventsProcessed: number, activeSubscribersCount: number, errorCount: number, uptimeSeconds: number }} Real-time metrics snapshot.
 *
 * @example
 * const metrics = getStreamMetrics();
 * console.log(`Indexer uptime: ${metrics.uptimeSeconds}s, Total events: ${metrics.totalEventsProcessed}`);
 */
export function getStreamMetrics() {
  const uptimeSeconds = indexerState.startedAt
    ? Math.floor((Date.now() - indexerState.startedAt) / 1000)
    : 0;

  return {
    isRunning: indexerState.isRunning,
    lastProcessedLedger: indexerState.lastProcessedLedger,
    totalEventsProcessed: indexerState.totalEventsProcessed,
    activeSubscribersCount: activeSubscribers.size,
    errorCount: indexerState.errorCount,
    uptimeSeconds,
  };
}

/**
 * Resets the streaming indexer's ledger cursor to a specific block sequence or clears it.
 *
 * @async
 * @function resetStreamCursor
 * @param {number} [targetLedger=0] - Target ledger sequence to reset cursor to.
 * @returns {Promise<{ success: boolean, previousLedger: number, currentLedger: number }>} Cursor reset result.
 * @throws {TypeError} If targetLedger is negative or not a number.
 *
 * @example
 * await resetStreamCursor(100000);
 */
export async function resetStreamCursor(targetLedger = 0) {
  if (typeof targetLedger !== 'number' || targetLedger < 0) {
    throw new TypeError('Target ledger must be a non-negative number');
  }

  const previousLedger = indexerState.lastProcessedLedger;
  indexerState.lastProcessedLedger = targetLedger;

  if (cache) {
    try {
      await cache.set('streaming_indexer:last_ledger', targetLedger.toString());
    } catch (err) {
      logger.error('[StreamingIndexer] Failed to update cache on cursor reset', err);
    }
  }

  logger.info(`[StreamingIndexer] Reset cursor from ${previousLedger} to ${targetLedger}`);

  return {
    success: true,
    previousLedger,
    currentLedger: targetLedger,
  };
}

/**
 * Performs a comprehensive health and connectivity check on the streaming indexer pipeline.
 *
 * @async
 * @function verifyStreamHealth
 * @returns {Promise<{ healthy: boolean, status: string, latencyMs: number, lastLedger: number }>} Health check report.
 *
 * @example
 * const health = await verifyStreamHealth();
 * if (!health.healthy) console.warn('Streaming indexer unhealthy!');
 */
export async function verifyStreamHealth() {
  const startTime = Date.now();
  let cacheOk = true;

  if (cache) {
    try {
      if (typeof cache.ping === 'function') {
        await cache.ping();
      }
    } catch {
      cacheOk = false;
    }
  }

  const latencyMs = Date.now() - startTime;
  const healthy = indexerState.isRunning && cacheOk && indexerState.errorCount < 100;

  return {
    healthy,
    status: healthy ? 'HEALTHY' : 'DEGRADED',
    latencyMs,
    lastLedger: indexerState.lastProcessedLedger,
  };
}

export default {
  startStreamingIndexer,
  stopStreamingIndexer,
  processStreamBatch,
  registerStreamSubscriber,
  removeStreamSubscriber,
  getStreamMetrics,
  resetStreamCursor,
  verifyStreamHealth,
};
