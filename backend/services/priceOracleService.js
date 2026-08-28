/**
 * Price Oracle Service
 *
 * Fetches and caches the current XLM/USD exchange rate from the Stellar
 * Horizon DEX order book. Used by the payment service and any component
 * that needs a fiat-to-crypto conversion rate.
 */

const STELLAR_HORIZON =
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const USDC_ISSUER =
  process.env.USDC_ISSUER ||
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Simple in-process cache: { price, fetchedAt }
let _cache = null;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetch XLM/USD price from Stellar Horizon DEX order book.
 * Returns price as a float (USD per 1 XLM).
 */
async function fetchXlmUsdPrice() {
  const url =
    `${STELLAR_HORIZON}/order_book` +
    `?selling_asset_type=native` +
    `&buying_asset_type=credit_alphanum4` +
    `&buying_asset_code=USDC` +
    `&buying_asset_issuer=${USDC_ISSUER}` +
    `&limit=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Horizon order book request failed: ${res.status}`);
  }

  const { bids } = await res.json();
  if (!Array.isArray(bids) || bids.length === 0) {
    throw new Error('No bids available in XLM/USDC order book');
  }

  return parseFloat(bids[0].price);
}

/**
 * Get the current XLM/USD price, using a 1-minute in-process cache.
 * @returns {Promise<number>} USD per 1 XLM
 */
async function getXlmUsdPrice() {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.price;
  }

  const price = await fetchXlmUsdPrice();
  _cache = { price, fetchedAt: now };
  return price;
}

/**
 * Convert a USD amount to XLM using the current exchange rate.
 * @param {number} usd - Amount in USD
 * @returns {Promise<string>} XLM amount as a string with 7 decimal places
 */
async function usdToXlm(usd) {
  const price = await getXlmUsdPrice();
  return (usd / price).toFixed(7);
}

/**
 * Convert an XLM amount to USD using the current exchange rate.
 * @param {number} xlm - Amount in XLM
 * @returns {Promise<number>} USD equivalent
 */
async function xlmToUsd(xlm) {
  const price = await getXlmUsdPrice();
  return xlm * price;
}

/** Reset the in-process cache — for testing only. */
function __resetCacheForTests() {
  _cache = null;
}

export default {
  getXlmUsdPrice,
  fetchXlmUsdPrice,
  usdToXlm,
  xlmToUsd,
  __resetCacheForTests,
};
