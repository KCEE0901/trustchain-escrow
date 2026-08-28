'use client';

/**
 * useLiveXlmRate.js
 *
 * React hook that polls a live XLM/USD exchange rate endpoint at a
 * configurable interval. All behaviour is driven by environment variables
 * so that it can be tuned per-environment without a code change.
 *
 * ── Environment variables ────────────────────────────────────────────────────
 *
 * NEXT_PUBLIC_XLM_PRICE_API_URL
 *   Base URL for the XLM price API. The hook appends no path — the URL must
 *   point to an endpoint that returns JSON with at minimum a `price` field
 *   (number, USD value of 1 XLM) and a `timestamp` field (ISO-8601 string
 *   or Unix epoch ms).
 *   Example: https://api.example.com/v1/xlm-usd
 *
 * NEXT_PUBLIC_XLM_POLL_INTERVAL_MS
 *   How frequently (in milliseconds) the hook re-fetches the rate.
 *   Default: 30000 (30 seconds). Set to 0 to disable polling (fetch once only).
 *
 * NEXT_PUBLIC_XLM_RATE_STALE_THRESHOLD_MS
 *   If the most recently received rate is older than this value (in ms), the
 *   hook sets `isStale: true` in its return value so the UI can show a
 *   "stale data" warning. Default: 120000 (2 minutes).
 *
 * NEXT_PUBLIC_XLM_API_TIMEOUT_MS
 *   Abort timeout (in milliseconds) for each individual fetch request.
 *   If the API does not respond within this window the request is cancelled
 *   and the previous rate is retained. Default: 10000 (10 seconds).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Environment variable resolution ─────────────────────────────────────────

/**
 * Base URL for the XLM price API.
 * Must be set; the hook will log a warning and return an error state if absent.
 * @type {string | undefined}
 */
const XLM_PRICE_API_URL = process.env.NEXT_PUBLIC_XLM_PRICE_API_URL;

/**
 * Polling interval in milliseconds.
 * Parsed from NEXT_PUBLIC_XLM_POLL_INTERVAL_MS; defaults to 30 000 ms.
 * @type {number}
 */
const POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_XLM_POLL_INTERVAL_MS ?? 30_000
);

/**
 * Age threshold (ms) beyond which the cached rate is considered stale.
 * Parsed from NEXT_PUBLIC_XLM_RATE_STALE_THRESHOLD_MS; defaults to 120 000 ms.
 * @type {number}
 */
const RATE_STALE_THRESHOLD_MS = Number(
  process.env.NEXT_PUBLIC_XLM_RATE_STALE_THRESHOLD_MS ?? 120_000
);

/**
 * Per-request fetch timeout in milliseconds.
 * Parsed from NEXT_PUBLIC_XLM_API_TIMEOUT_MS; defaults to 10 000 ms.
 * @type {number}
 */
const API_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_XLM_API_TIMEOUT_MS ?? 10_000
);

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} XlmRateState
 * @property {number | null}  rate        - Current XLM/USD rate, or null before first fetch.
 * @property {Date | null}    lastUpdated - Timestamp of the most recent successful fetch.
 * @property {boolean}        isLoading   - True while the very first fetch is in progress.
 * @property {boolean}        isStale     - True when the rate is older than RATE_STALE_THRESHOLD_MS.
 * @property {string | null}  error       - Error message from the most recent failed fetch, or null.
 */

/**
 * Polls the configured XLM/USD price API and returns live rate data.
 *
 * @returns {XlmRateState}
 *
 * @example
 * const { rate, isLoading, isStale, error } = useLiveXlmRate();
 * if (isLoading) return <Spinner />;
 * if (error)     return <p>Could not load XLM rate: {error}</p>;
 * return <p>{isStale ? '⚠ stale ' : ''}{rate} USD</p>;
 */
export function useLiveXlmRate() {
  const [rate, setRate] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState(null);

  // Ref-based flag so the cleanup function can cancel in-flight work.
  const mountedRef = useRef(true);

  // ── Core fetch ─────────────────────────────────────────────────────────────

  const fetchRate = useCallback(async () => {
    if (!XLM_PRICE_API_URL) {
      const msg =
        'NEXT_PUBLIC_XLM_PRICE_API_URL is not set. Cannot fetch live XLM rate.';
      console.warn('[useLiveXlmRate]', msg);
      if (mountedRef.current) {
        setError(msg);
        setIsLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(XLM_PRICE_API_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      // Support both { price: number } and { USD: number } response shapes.
      const rawRate = json?.price ?? json?.USD ?? json?.rate;
      if (typeof rawRate !== 'number') {
        throw new Error(
          `Unexpected response shape — no numeric rate field found: ${JSON.stringify(json)}`
        );
      }

      if (mountedRef.current) {
        const now = new Date();
        setRate(rawRate);
        setLastUpdated(now);
        setIsStale(false);
        setError(null);
        setIsLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message =
          err.name === 'AbortError'
            ? `Request timed out after ${API_TIMEOUT_MS} ms`
            : err.message;
        setError(message);
        setIsLoading(false);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  // ── Staleness checker ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!lastUpdated) return;

    const checkStale = () => {
      if (!mountedRef.current) return;
      const age = Date.now() - lastUpdated.getTime();
      setIsStale(age > RATE_STALE_THRESHOLD_MS);
    };

    // Re-check staleness every second so the flag flips promptly.
    const intervalId = setInterval(checkStale, 1_000);
    checkStale(); // immediate check

    return () => clearInterval(intervalId);
  }, [lastUpdated]);

  // ── Polling ────────────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Fetch immediately on mount.
    fetchRate();

    // Set up polling if the interval is positive.
    let pollId;
    if (POLL_INTERVAL_MS > 0) {
      pollId = setInterval(fetchRate, POLL_INTERVAL_MS);
    }

    return () => {
      mountedRef.current = false;
      if (pollId) clearInterval(pollId);
    };
  }, [fetchRate]);

  return { rate, lastUpdated, isLoading, isStale, error };
}

export default useLiveXlmRate;
