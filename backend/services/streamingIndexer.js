/**
 * Streaming Indexer
 *
 * Companion to `backend/api/routes/streamRoutes.js`: takes raw ContractEvent-
 * shaped records (from the poller or a backfill job) and turns them into the
 * normalized, stream-safe shape SSE clients expect — validating required
 * fields and formatting BigInt/Date values into JSON-serialisable strings.
 *
 * `indexRecord`, `reindexRecord`, and `previewRecord` all need the exact same
 * validation + formatting step, so it lives in one place (`toStreamRecord`)
 * instead of being copy-pasted into each function, which is what previously
 * caused the three call sites to drift out of sync.
 *
 * @module services/streamingIndexer
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('streamingIndexer');

/** Fields every raw event must carry before it can be indexed or streamed. */
const REQUIRED_FIELDS = ['eventType', 'ledger', 'ledgerAt', 'txHash', 'eventIndex'];

/** In-memory store of indexed records, keyed by `${txHash}:${eventIndex}`. Swappable for a real store later. */
const indexedRecords = new Map();

/**
 * Validates a raw event and formats it into the normalized shape used by
 * both the indexer's store and the SSE stream payloads. Throws a
 * `StreamValidationError` if a required field is missing or malformed.
 *
 * This is the single source of truth for "what does a valid, formatted
 * stream record look like" — `indexRecord`, `reindexRecord`, and
 * `previewRecord` all delegate to it rather than re-implementing the same
 * checks.
 *
 * @param {Record<string, unknown>} raw
 * @returns {{
 *   key: string,
 *   eventType: string,
 *   escrowId: string | null,
 *   ledger: string,
 *   ledgerAt: string,
 *   contractId: string | null,
 *   txHash: string,
 *   eventIndex: number,
 *   topics: unknown,
 *   data: unknown,
 * }}
 */
export function toStreamRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new StreamValidationError('Event payload must be an object.');
  }

  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === '') {
      throw new StreamValidationError(`Event payload is missing required field "${field}".`);
    }
  }

  const ledger = coerceLedger(raw.ledger);
  const ledgerAt = coerceIsoDate(raw.ledgerAt);
  const eventIndex = Number(raw.eventIndex);
  if (!Number.isInteger(eventIndex) || eventIndex < 0) {
    throw new StreamValidationError('eventIndex must be a non-negative integer.');
  }

  return {
    key: `${raw.txHash}:${eventIndex}`,
    eventType: String(raw.eventType),
    escrowId: raw.escrowId != null ? String(raw.escrowId) : null,
    ledger,
    ledgerAt,
    contractId: raw.contractId != null ? String(raw.contractId) : null,
    txHash: String(raw.txHash),
    eventIndex,
    topics: raw.topics ?? null,
    data: raw.data ?? null,
  };
}

/** Thrown by `toStreamRecord` when a raw event fails validation. */
export class StreamValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StreamValidationError';
  }
}

function coerceLedger(value) {
  try {
    return String(BigInt(value));
  } catch {
    throw new StreamValidationError(`ledger must be an integer-like value, got: ${value}`);
  }
}

function coerceIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new StreamValidationError(`ledgerAt must be a valid date, got: ${value}`);
  }
  return date.toISOString();
}

/**
 * Validates, formats, and stores a single raw event. Idempotent — indexing
 * the same (txHash, eventIndex) pair twice overwrites in place rather than
 * duplicating.
 *
 * @param {Record<string, unknown>} raw
 * @returns {ReturnType<typeof toStreamRecord>}
 */
export function indexRecord(raw) {
  const record = toStreamRecord(raw);
  indexedRecords.set(record.key, record);
  return record;
}

/**
 * Re-validates and re-formats a batch of raw events for a backfill run,
 * replacing whatever was previously indexed for those keys.
 *
 * @param {Record<string, unknown>[]} rawEvents
 * @returns {{ indexed: number, failed: { raw: Record<string, unknown>, error: string }[] }}
 */
export function reindexRecords(rawEvents) {
  let indexed = 0;
  const failed = [];

  for (const raw of rawEvents) {
    try {
      indexRecord(raw);
      indexed++;
    } catch (err) {
      failed.push({ raw, error: err.message });
      log.warn({ msg: 'streaming_indexer_reindex_failed', error: err.message });
    }
  }

  return { indexed, failed };
}

/**
 * Validates and formats a raw event without storing it — used by callers
 * that want to check whether a payload would be accepted before indexing it.
 *
 * @param {Record<string, unknown>} raw
 * @returns {ReturnType<typeof toStreamRecord>}
 */
export function previewRecord(raw) {
  return toStreamRecord(raw);
}

/** Returns the currently indexed record for a given (txHash, eventIndex) key, or undefined. */
export function getIndexedRecord(txHash, eventIndex) {
  return indexedRecords.get(`${txHash}:${eventIndex}`);
}

/** Number of records currently held by the in-memory index. Useful for tests/metrics. */
export function indexedCount() {
  return indexedRecords.size;
}
