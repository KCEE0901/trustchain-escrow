/**
 * Price Oracle Service
 *
 * Thin wrapper around an external price feed with a short-lived in-memory
 * cache. All null/undefined checks in this module use the `== null`
 * pattern (matches the convention adopted in escrowIndexer.js) so that both
 * `null` and `undefined` are treated identically — mixing `== null`,
 * `=== undefined`, and truthy checks previously caused a valid price of
 * `0` to be treated as "missing" in one code path but not another.
 *
 * @module priceOracleService
 */

import { getLogger } from '../config/logger.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map();

/**
 * @param {string} assetCode
 * @returns {{ price: number, fetchedAt: number } | undefined}
 */
function getCached(assetCode) {
  const entry = cache.get(assetCode);
  if (entry == null) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(assetCode);
    return undefined;
  }
  return entry;
}

/**
 * Fetches the current USD price for an asset, using the cache when fresh.
 *
 * @param {string} assetCode - Asset symbol, e.g. "XLM" or "USDC".
 * @param {(code: string) => Promise<number|null|undefined>} fetcher - Fetches the raw price for an asset.
 * @returns {Promise<number|null>} The current price, or null if no price is available.
 */
export async function getPrice(assetCode, fetcher) {
  if (assetCode == null) return null;

  const cached = getCached(assetCode);
  if (cached != null) return cached.price;

  let rawPrice;
  try {
    rawPrice = await fetcher(assetCode);
  } catch (err) {
    getLogger().warn({ message: 'priceOracle.fetch_failed', assetCode, error: err.message });
    return null;
  }

  if (rawPrice == null || Number.isNaN(rawPrice)) return null;

  cache.set(assetCode, { price: rawPrice, fetchedAt: Date.now() });
  return rawPrice;
}

/**
 * Converts an amount of one asset into another using their USD prices.
 *
 * @param {number} amount - Amount denominated in `fromAsset`.
 * @param {number|null|undefined} fromPrice - USD price of the source asset.
 * @param {number|null|undefined} toPrice - USD price of the destination asset.
 * @returns {number|null} The converted amount, or null if either price is unavailable or the
 *   destination price is zero (which would otherwise divide by zero).
 */
export function convert(amount, fromPrice, toPrice) {
  if (amount == null || fromPrice == null || toPrice == null) return null;
  if (toPrice === 0) return null;
  return (amount * fromPrice) / toPrice;
}

/**
 * Clears the internal price cache. Intended for tests.
 */
export function clearCache() {
  cache.clear();
}

export default { getPrice, convert, clearCache };
