/**
 * Streaming Indexer Service
 *
 * Handles on-chain payment-stream events and syncs stream state into the
 * database. All null/undefined checks in this file use the `== null`
 * pattern (matches value `null` or `undefined`, but not `0`, `''`, or
 * `false`) — this was previously inconsistent (mix of `== null`,
 * `=== undefined`, and truthy checks), which caused streams with an id of
 * `0` or an amount of `0` to be silently skipped.
 *
 * @module services/streamingIndexer
 */

import { createModuleLogger } from '../config/logger.js';
import prisma from '../lib/prisma.js';

const streamLogger = createModuleLogger('streamingIndexer');

/**
 * Handle a `stream_created` contract event.
 * Skips the event when the stream id or sender is genuinely missing
 * (undefined/null), but processes valid falsy values like id `0`.
 */
export async function handleStreamCreated(event) {
  const streamId = event?.topic?.[1];
  const sender = event?.data?.sender;

  if (streamId == null || sender == null) {
    streamLogger.warn({ message: 'stream_created_missing_fields', event });
    return;
  }

  await prisma.paymentStream.upsert({
    where: { id: BigInt(streamId) },
    update: { sender, status: 'Active' },
    create: {
      id: BigInt(streamId),
      sender,
      recipient: event.data?.recipient ?? null,
      amount: event.data?.amount ?? 0,
      status: 'Active',
    },
  });
}

/**
 * Handle a `stream_withdrawn` contract event.
 * `amount` of `0` is a valid (no-op) withdrawal and must still update
 * `lastWithdrawnAt`, so it is checked with `== null`, not truthiness.
 */
export async function handleStreamWithdrawn(event) {
  const streamId = event?.topic?.[1];
  const amount = event?.data?.amount;

  if (streamId == null || amount == null) {
    streamLogger.warn({ message: 'stream_withdrawn_missing_fields', event });
    return;
  }

  await prisma.paymentStream.updateMany({
    where: { id: BigInt(streamId) },
    data: { lastWithdrawnAt: new Date(), lastWithdrawnAmount: amount },
  });
}

/**
 * Handle a `stream_cancelled` contract event.
 */
export async function handleStreamCancelled(event) {
  const streamId = event?.topic?.[1];

  if (streamId == null) {
    streamLogger.warn({ message: 'stream_cancelled_missing_stream_id', event });
    return;
  }

  await prisma.paymentStream.updateMany({
    where: { id: BigInt(streamId) },
    data: { status: 'Cancelled' },
  });
}

/**
 * Resolve the display status for a stream, defaulting to 'Unknown' only
 * when the field is truly absent (not when it's an empty string, which
 * indicates a status that was explicitly cleared).
 */
export function resolveStreamStatus(stream) {
  if (stream?.status == null) return 'Unknown';
  return stream.status;
}

export default {
  handleStreamCreated,
  handleStreamWithdrawn,
  handleStreamCancelled,
  resolveStreamStatus,
};
