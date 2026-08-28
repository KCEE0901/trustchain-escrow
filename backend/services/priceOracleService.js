/**
 * Price Oracle Service
 *
 * Fetches XLM/USD (and other asset) price data from a configurable external
 * oracle endpoint. Wraps raw fetches with a 60-second in-memory cache so
 * callers avoid hammering the upstream source on every request.
 *
 * Environment:
 *   PRICE_ORACLE_URL — base URL of the price oracle API
 *                      e.g. https://oracle.example.com/prices
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('priceOracleService');

// ── In-memory cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds

/** @type {Map<string, { data: object, fetchedAt: number }>} */
const priceCache = new Map();

// ── validatePriceData ────────────────────────────────────────────────────────

/**
 * Validate that a price data object has all required fields and correct types.
 *
 * @param {unknown} data - The value to validate.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePriceData(data) {
  const errors = [];

  if (data === null || data === undefined || typeof data !== 'object') {
    return { valid: false, errors: ['Price data must be a non-null object.'] };
  }

  if (!('asset' in data) || data.asset === undefined || data.asset === null) {
    errors.push('Missing required field: asset.');
  }

  if (!('price' in data) || data.price === undefined || data.price === null) {
    errors.push('Missing required field: price.');
  } else if (typeof data.price !== 'number' || Number.isNaN(data.price)) {
    errors.push('Field "price" must be a numeric value.');
  } else if (data.price < 0) {
    errors.push('Field "price" must not be negative.');
  }

  if (!('timestamp' in data) || data.timestamp === undefined || data.timestamp === null) {
    errors.push('Missing required field: timestamp.');
  }

  return { valid: errors.length === 0, errors };
}

// ── formatPrice ──────────────────────────────────────────────────────────────

/**
 * Format a numeric price to a fixed number of decimal places.
 *
 * @param {number} value    - The numeric price to format.
 * @param {number} decimals - Number of decimal places (default: 2).
 * @returns {string} The formatted price string.
 */
export function formatPrice(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

// ── fetchPrice ───────────────────────────────────────────────────────────────

/**
 * Fetch the current price for the given asset from the external oracle.
 *
 * Makes a GET request to `${PRICE_ORACLE_URL}/${asset}` and parses the
 * JSON response. Throws a descriptive error on network failure or a
 * malformed response.
 *
 * @param {string} asset - Asset symbol to fetch (e.g. 'XLM', 'USDC').
 * @returns {Promise<{ asset: string, price: number, timestamp: string, source: string }>}
 */
export async function fetchPrice(asset) {
  const oracleUrl = process.env.PRICE_ORACLE_URL;

  if (!oracleUrl) {
    throw new Error('PRICE_ORACLE_URL is not configured.');
  }

  const url = `${oracleUrl}/${encodeURIComponent(asset)}`;

  log.info({ message: 'price_fetch_start', asset, url });

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    log.error({ message: 'price_fetch_network_error', asset, error: err.message });
    throw new Error(`Network error while fetching price for ${asset}: ${err.message}`);
  }

  if (!res.ok) {
    log.error({ message: 'price_fetch_http_error', asset, status: res.status });
    throw new Error(
      `Oracle returned HTTP ${res.status} while fetching price for ${asset}.`,
    );
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    log.error({ message: 'price_fetch_parse_error', asset, error: err.message });
    throw new Error(
      `Oracle response for ${asset} could not be parsed as JSON: ${err.message}`,
    );
  }

  const { valid, errors } = validatePriceData(body);
  if (!valid) {
    log.error({ message: 'price_fetch_invalid_response', asset, errors });
    throw new Error(
      `Oracle response for ${asset} is missing required fields: ${errors.join(' ')}`,
    );
  }

  const result = {
    asset: body.asset,
    price: body.price,
    timestamp: body.timestamp,
    source: body.source ?? oracleUrl,
  };

  log.info({ message: 'price_fetch_success', asset, price: result.price });

  return result;
}

// ── getPrice ─────────────────────────────────────────────────────────────────

/**
 * Return the current price for the given asset, using an in-memory cache.
 *
 * Returns the cached value if the entry is less than 60 seconds old.
 * Otherwise re-fetches from the oracle and updates the cache.
 *
 * @param {string} asset - Asset symbol to look up (e.g. 'XLM').
 * @returns {Promise<{ asset: string, price: number, timestamp: string, source: string }>}
 */
export async function getPrice(asset) {
  const cached = priceCache.get(asset);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    log.info({ message: 'price_cache_hit', asset, age: now - cached.fetchedAt });
    return cached.data;
  }

  const data = await fetchPrice(asset);
  priceCache.set(asset, { data, fetchedAt: now });

  return data;
}

export default {
  validatePriceData,
  formatPrice,
  fetchPrice,
  getPrice,
};
