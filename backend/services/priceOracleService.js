/**
 * Price Oracle Service
 *
 * Fetches and caches the current XLM/USD exchange rate from the Stellar
 * SDEX order book via Horizon. Exposes helpers for converting between
 * XLM stroops, XLM, and USD used throughout the escrow pricing layer.
 *
 * All inline numeric literals have been extracted into named constants
 * so their intent is self-documenting. Closes #98.
 *
 * @module services/priceOracleService
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('priceOracleService');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of stroops (micro-XLM) in 1 XLM. */
export const STROOPS_PER_XLM = 10_000_000;

/** Default TTL for the cached exchange rate, in milliseconds (5 minutes). */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** HTTP request timeout for Horizon calls, in milliseconds (8 seconds). */
export const FETCH_TIMEOUT_MS = 8_000;

/** Maximum number of order-book entries to fetch from Horizon per request. */
export const ORDER_BOOK_LIMIT = 20;

/** Number of retry attempts before giving up on a failed Horizon request. */
export const MAX_RETRIES = 3;

/** Base delay in milliseconds between retry attempts (doubles each attempt). */
export const RETRY_BASE_DELAY_MS = 500;

/** Minimum acceptable XLM/USD price; values below this are treated as stale. */
export const MIN_VALID_PRICE_USD = 0.0001;

/** Maximum acceptable XLM/USD price; values above this are treated as stale. */
export const MAX_VALID_PRICE_USD = 10_000;

/** Percentage deviation (0–1) that triggers a stale-price warning. */
export const STALE_PRICE_DEVIATION_THRESHOLD = 0.5;

/** Horizon base URL used when no override is provided. */
export const DEFAULT_HORIZON_URL = 'https://horizon.stellar.org';

// ── In-memory cache ───────────────────────────────────────────────────────────

let _cachedPrice = null; // { rate: number, fetchedAt: number }
let _horizonUrl = DEFAULT_HORIZON_URL;

/**
 * Override the Horizon base URL (useful for tests / testnet).
 * @param {string} url
 */
export function setHorizonUrl(url) {
  _horizonUrl = url;
}

/**
 * Clear the in-memory price cache (useful for tests).
 */
export function clearCache() {
  _cachedPrice = null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when the cached price is still within its TTL window.
 * @returns {boolean}
 */
function isCacheValid() {
  return (
    _cachedPrice !== null &&
    Date.now() - _cachedPrice.fetchedAt < CACHE_TTL_MS
  );
}

/**
 * Validates that a candidate price is within the accepted range.
 * @param {number} price
 * @returns {boolean}
 */
export function isValidPrice(price) {
  return (
    typeof price === 'number' &&
    Number.isFinite(price) &&
    price >= MIN_VALID_PRICE_USD &&
    price <= MAX_VALID_PRICE_USD
  );
}

/**
 * Pause execution for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch the mid-price from the Horizon XLM/USD order book.
 * Retries up to MAX_RETRIES times with exponential back-off.
 *
 * @returns {Promise<number>} XLM price in USD
 * @throws {Error} when all retries are exhausted or the price is invalid
 */
export async function fetchLivePrice() {
  const url =
    `${_horizonUrl}/order_book` +
    `?selling_asset_type=native` +
    `&buying_asset_type=credit_alphanum4` +
    `&buying_asset_code=USDC` +
    `&buying_asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` +
    `&limit=${ORDER_BOOK_LIMIT}`;

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Horizon responded with HTTP ${res.status}`);
      }

      const data = await res.json();

      const asks = data?.asks ?? [];
      const bids = data?.bids ?? [];

      if (!asks.length && !bids.length) {
        throw new Error('Order book is empty — no price available');
      }

      const bestAsk = asks.length ? parseFloat(asks[0].price) : null;
      const bestBid = bids.length ? parseFloat(bids[0].price) : null;

      let price;
      if (bestAsk !== null && bestBid !== null) {
        price = (bestAsk + bestBid) / 2;
      } else {
        price = bestAsk ?? bestBid;
      }

      if (!isValidPrice(price)) {
        throw new Error(`Fetched price ${price} is outside acceptable range`);
      }

      return price;
    } catch (err) {
      lastError = err;
      log.warn({ message: 'price_fetch_attempt_failed', attempt, error: err.message });
    }
  }

  throw new Error(`fetchLivePrice failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the current XLM/USD rate, using the cache when still valid.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.forceRefresh=false]  skip the cache
 * @returns {Promise<number>}
 */
export async function getXlmUsdRate(opts = {}) {
  if (!opts.forceRefresh && isCacheValid()) {
    log.debug({ message: 'price_cache_hit', rate: _cachedPrice.rate });
    return _cachedPrice.rate;
  }

  const rate = await fetchLivePrice();
  _cachedPrice = { rate, fetchedAt: Date.now() };
  log.debug({ message: 'price_cache_updated', rate });
  return rate;
}

/**
 * Convert an amount in XLM stroops to USD.
 *
 * @param {number} stroops
 * @param {number} xlmUsdRate - current XLM/USD exchange rate
 * @returns {number}
 */
export function stroopsToUsd(stroops, xlmUsdRate) {
  return (stroops / STROOPS_PER_XLM) * xlmUsdRate;
}

/**
 * Convert an amount in XLM to USD.
 *
 * @param {number} xlm
 * @param {number} xlmUsdRate
 * @returns {number}
 */
export function xlmToUsd(xlm, xlmUsdRate) {
  return xlm * xlmUsdRate;
}

/**
 * Convert an amount in USD to XLM.
 *
 * @param {number} usd
 * @param {number} xlmUsdRate
 * @returns {number}
 */
export function usdToXlm(usd, xlmUsdRate) {
  if (xlmUsdRate === 0) throw new Error('xlmUsdRate must not be zero');
  return usd / xlmUsdRate;
}

/**
 * Convert XLM to stroops.
 *
 * @param {number} xlm
 * @returns {number}
 */
export function xlmToStroops(xlm) {
  return Math.round(xlm * STROOPS_PER_XLM);
}

export default {
  getXlmUsdRate,
  fetchLivePrice,
  stroopsToUsd,
  xlmToUsd,
  usdToXlm,
  xlmToStroops,
  isValidPrice,
  setHorizonUrl,
  clearCache,
  // constants
  STROOPS_PER_XLM,
  CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
  ORDER_BOOK_LIMIT,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  MIN_VALID_PRICE_USD,
  MAX_VALID_PRICE_USD,
  STALE_PRICE_DEVIATION_THRESHOLD,
  DEFAULT_HORIZON_URL,
};
