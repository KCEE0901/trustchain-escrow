/**
 * Fee Estimation Service
 *
 * Estimates the Soroban/Stellar transaction fee (in stroops) a client should
 * set for an escrow operation, based on recent network fee stats. Falls back
 * to the network minimum when the RPC fee-stats call is unavailable, and
 * applies surge pricing when the ledger is heavily utilized.
 *
 * @module services/feeEstimationService
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('feeEstimationService');

// ── Named constants (previously inline magic numbers) ──────────────────────────

/** Stellar network floor: the minimum base fee accepted per operation, in stroops. */
const MIN_BASE_FEE_STROOPS = 100;

/** Hard ceiling on any single fee estimate, in stroops — matches the relayer's safety cap so a spiking network can't produce a runaway fee. */
const MAX_FEE_STROOPS = 1_000_000;

/** How long an RPC call to fetch fee stats may take before we give up and fall back to the floor fee. */
const RPC_TIMEOUT_MS = 5_000;

/** How long a fetched fee-stats sample stays valid before we refetch, to avoid hammering the RPC endpoint on every estimate call. */
const FEE_STATS_CACHE_TTL_MS = 10_000;

/** Number of times a transient RPC failure is retried before falling back to the floor fee. */
const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff between retries (attempt N waits `RETRY_BACKOFF_BASE_MS * 2^N`). */
const RETRY_BACKOFF_BASE_MS = 250;

/** Ledger utilization (0–1) above which we consider the network congested and apply surge pricing. */
const SURGE_UTILIZATION_THRESHOLD = 0.8;

/** Multiplier applied to the base fee once utilization crosses SURGE_UTILIZATION_THRESHOLD. */
const SURGE_FEE_MULTIPLIER = 2;

/** Percentile used for the "standard" priority fee estimate. */
const STANDARD_PERCENTILE = 50;

/** Percentile used for the "high" priority fee estimate — pays more to land ahead of congestion. */
const HIGH_PRIORITY_PERCENTILE = 95;

// ── In-process cache ─────────────────────────────────────────────────────────

let cachedStats = null;
let cachedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches ledger fee stats with a timeout and retry/backoff, using
 * `fetchFn` (injectable for tests) to perform the actual RPC call.
 *
 * @param {() => Promise<{ p50: number, p95: number, utilization: number }>} fetchFn
 */
async function fetchFeeStatsWithRetry(fetchFn) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await Promise.race([
        fetchFn(),
        sleep(RPC_TIMEOUT_MS).then(() => {
          throw new Error('Fee stats RPC call timed out.');
        }),
      ]);
    } catch (err) {
      lastError = err;
      log.warn({ msg: 'fee_stats_fetch_retry', attempt, error: err.message });
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_BASE_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

/**
 * Returns the current fee stats, using the in-process cache when fresh.
 *
 * @param {() => Promise<{ p50: number, p95: number, utilization: number }>} fetchFn
 */
async function getFeeStats(fetchFn) {
  const now = Date.now();
  if (cachedStats && now - cachedAt < FEE_STATS_CACHE_TTL_MS) {
    return cachedStats;
  }

  try {
    cachedStats = await fetchFeeStatsWithRetry(fetchFn);
    cachedAt = now;
  } catch (err) {
    log.error({ msg: 'fee_stats_fetch_failed', error: err.message });
    // No fresh stats available — callers fall back to the network floor fee.
    return null;
  }

  return cachedStats;
}

function clampFee(feeStroops) {
  return Math.min(MAX_FEE_STROOPS, Math.max(MIN_BASE_FEE_STROOPS, Math.round(feeStroops)));
}

/**
 * Estimates the fee (in stroops) to use for a transaction.
 *
 * @param {'standard' | 'high'} priority
 * @param {() => Promise<{ p50: number, p95: number, utilization: number }>} [fetchFn]
 *        Injectable fee-stats fetcher, defaults to a stub that always fails
 *        (so callers without an RPC client still get the safe floor fee).
 * @returns {Promise<number>} estimated fee in stroops
 */
export async function estimateFee(priority = 'standard', fetchFn = defaultFetchFn) {
  const stats = await getFeeStats(fetchFn);
  if (!stats) {
    return MIN_BASE_FEE_STROOPS;
  }

  const percentile = priority === 'high' ? HIGH_PRIORITY_PERCENTILE : STANDARD_PERCENTILE;
  const baseFee = percentile === HIGH_PRIORITY_PERCENTILE ? stats.p95 : stats.p50;

  const surged =
    stats.utilization >= SURGE_UTILIZATION_THRESHOLD ? baseFee * SURGE_FEE_MULTIPLIER : baseFee;

  return clampFee(surged);
}

async function defaultFetchFn() {
  throw new Error('No fee-stats fetcher configured.');
}

export const FEE_ESTIMATION_CONSTANTS = {
  MIN_BASE_FEE_STROOPS,
  MAX_FEE_STROOPS,
  RPC_TIMEOUT_MS,
  FEE_STATS_CACHE_TTL_MS,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_BASE_MS,
  SURGE_UTILIZATION_THRESHOLD,
  SURGE_FEE_MULTIPLIER,
  STANDARD_PERCENTILE,
  HIGH_PRIORITY_PERCENTILE,
};
