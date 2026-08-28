/**
 * Environment variables used by the streaming indexer:
 * - STREAM_INDEXER_RPC_URL: RPC endpoint used to fetch ledger updates
 * - STREAM_INDEXER_POLL_INTERVAL_MS: polling interval for refresh loops
 * - STREAM_INDEXER_START_CURSOR: optional cursor used when replaying events
 */
export function getStreamingIndexerEnv() {
  return {
    rpcUrl: process.env.STREAM_INDEXER_RPC_URL ?? '',
    pollIntervalMs: Number(process.env.STREAM_INDEXER_POLL_INTERVAL_MS ?? 1000),
    startCursor: process.env.STREAM_INDEXER_START_CURSOR ?? '',
  };
}

export default { getStreamingIndexerEnv };
