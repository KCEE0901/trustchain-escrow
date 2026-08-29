/**
 * useLiveXlmRate
 *
 * Polls the backend rates endpoint for the live XLM -> fiat exchange rate.
 *
 * @module hooks/useLiveXlmRate
 */

import { useState, useEffect, useCallback } from 'react';

const DEFAULT_POLL_INTERVAL_MS = 30000;
const XLM_RATE_ENDPOINT = '/api/rates/xlm';

/**
 * Poll for the live XLM -> fiat exchange rate.
 *
 * @param {string} [currency='USD'] - Target fiat currency code.
 * @param {number} [pollIntervalMs=30000] - Polling interval in milliseconds.
 * @returns {{rate: number|null, loading: boolean, error: string|null}} Current
 *   rate state — `rate` is `null` until the first successful fetch, `loading`
 *   is true only during the initial fetch, and `error` holds the last fetch
 *   failure message (if any).
 */
export function useLiveXlmRate(currency = 'USD', pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRate = useCallback(async () => {
    if (!currency) {
      setError('Currency is required');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${XLM_RATE_ENDPOINT}?currency=${encodeURIComponent(currency)}`);
      if (!res.ok) {
        throw new Error(`Rate request failed with status ${res.status}`);
      }

      const data = await res.json();
      const parsedRate = Number(data?.rate);

      if (!data || typeof data.rate === 'undefined' || Number.isNaN(parsedRate)) {
        throw new Error('Malformed rate response');
      }

      setRate(parsedRate);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch XLM rate');
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    fetchRate();
    const interval = setInterval(fetchRate, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchRate, pollIntervalMs]);

  return { rate, loading, error };
}

/**
 * Format a numeric XLM rate as a localized currency string.
 *
 * @param {number|null} rate - The XLM -> fiat rate, e.g. from `useLiveXlmRate`.
 * @param {string} [currency='USD'] - ISO 4217 currency code to format with.
 * @returns {string} Formatted currency string, or an em dash if `rate` is
 *   `null`/`NaN`.
 */
export function formatXlmRate(rate, currency = 'USD') {
  if (rate == null || Number.isNaN(rate)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(rate);
}

/**
 * Default export — same hook as the named `useLiveXlmRate` export, provided
 * for callers that prefer a default import.
 *
 * @param {string} [currency='USD'] - Target fiat currency code.
 * @param {number} [pollIntervalMs=30000] - Polling interval in milliseconds.
 * @returns {{rate: number|null, loading: boolean, error: string|null}}
 */
export default useLiveXlmRate;
