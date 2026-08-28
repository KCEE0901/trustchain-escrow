/**
 * Streaming Indexer — real-time Horizon SSE ingestion
 *
 * Complements the polling-based `eventIndexer.js` by subscribing to Horizon's
 * Server-Sent Events stream for payment operations touching the platform's
 * escrow/treasury accounts, so newly-confirmed transfers show up in the DB
 * within seconds instead of waiting on the next poll tick.
 *
 * @module streamingIndexer
 */

import { createModuleLogger } from '../config/logger.js';
import prisma from '../lib/prisma.js';

const log = createModuleLogger('streamingIndexer');

const STREAMING_INDEXER_ENABLED = process.env.STREAMING_INDEXER_ENABLED === 'true';
const STREAMING_HORIZON_URL =
  process.env.STREAMING_HORIZON_URL ||
  process.env.STELLAR_HORIZON_URL ||
  'https://horizon-testnet.stellar.org';
const STREAMING_INDEXER_ACCOUNT = process.env.STREAMING_INDEXER_ACCOUNT || '';
const STREAMING_INDEXER_CURSOR = process.env.STREAMING_INDEXER_CURSOR || 'now';
const STREAMING_RECONNECT_DELAY_MS = parseInt(
  process.env.STREAMING_RECONNECT_DELAY_MS || '2000',
  10,
);
const STREAMING_MAX_RECONNECT_ATTEMPTS = parseInt(
  process.env.STREAMING_MAX_RECONNECT_ATTEMPTS || '10',
  10,
);
const STREAMING_BATCH_SIZE = parseInt(process.env.STREAMING_BATCH_SIZE || '50', 10);

let reconnectAttempts = 0;
let abortController = null;

/** Persists a raw payment/operation record picked up from the SSE stream. */
async function recordStreamedOperation(op) {
  await prisma.contractEvent.create({
    data: {
      ledger: BigInt(op.ledger ?? 0),
      ledgerAt: new Date(op.created_at ?? Date.now()),
      contractId: STREAMING_INDEXER_ACCOUNT || 'unknown',
      eventType: 'stream_op',
      escrowId: null,
      topics: [op.type],
      data: {
        id: op.id,
        from: op.from,
        to: op.to,
        amount: op.amount,
        assetCode: op.asset_code ?? 'native',
      },
      txHash: op.transaction_hash,
      eventIndex: 0,
    },
  });
}

/** Builds the Horizon SSE endpoint for the configured account's operations. */
function buildStreamUrl(cursor) {
  const base = `${STREAMING_HORIZON_URL}/accounts/${STREAMING_INDEXER_ACCOUNT}/payments`;
  return `${base}?cursor=${encodeURIComponent(cursor)}&limit=${STREAMING_BATCH_SIZE}`;
}

/**
 * Parses a single SSE "data:" line into a Horizon payment record.
 * Horizon sends a keep-alive `"hello"` string on connect, which is ignored.
 */
function parseSseChunk(chunk) {
  const records = [];
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '"hello"') continue;
    try {
      records.push(JSON.parse(raw));
    } catch {
      log.warn({ message: 'streaming_indexer_parse_failed', raw });
    }
  }
  return records;
}

/**
 * Connects to Horizon's SSE stream and processes payment operations as they
 * arrive. Reconnects with a fixed delay up to STREAMING_MAX_RECONNECT_ATTEMPTS
 * before giving up.
 */
async function startStreamingIndexer() {
  if (!STREAMING_INDEXER_ENABLED) {
    log.info({ message: 'streaming_indexer_disabled' });
    return;
  }
  if (!STREAMING_INDEXER_ACCOUNT) {
    log.warn({ message: 'streaming_indexer_account_unset' });
    return;
  }

  let cursor = STREAMING_INDEXER_CURSOR;
  abortController = new AbortController();

  while (reconnectAttempts < STREAMING_MAX_RECONNECT_ATTEMPTS) {
    try {
      const res = await fetch(buildStreamUrl(cursor), {
        headers: { Accept: 'text/event-stream' },
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Horizon stream returned ${res.status}`);
      }

      reconnectAttempts = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        const records = parseSseChunk(decoder.decode(value, { stream: true }));
        for (const op of records) {
          await recordStreamedOperation(op);
          cursor = op.paging_token ?? cursor;
        }
      }
    } catch (err) {
      reconnectAttempts += 1;
      log.error({
        message: 'streaming_indexer_connection_error',
        error: err.message,
        reconnectAttempts,
      });
      await new Promise((resolve) => setTimeout(resolve, STREAMING_RECONNECT_DELAY_MS));
    }
  }

  log.warn({ message: 'streaming_indexer_gave_up', reconnectAttempts });
}

/** Stops the streaming indexer, if running. */
function stopStreamingIndexer() {
  abortController?.abort();
  abortController = null;
  reconnectAttempts = 0;
}

export { startStreamingIndexer, stopStreamingIndexer, parseSseChunk, buildStreamUrl };
