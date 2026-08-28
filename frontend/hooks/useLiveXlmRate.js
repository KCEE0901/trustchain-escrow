'use client';

/**
 * useLiveXlmRate
 *
 * Polls a public price API for the current XLM/USD rate and keeps it fresh
 * in the background, with a localStorage fallback so a transient network
 * failure doesn't blank out an already-displayed rate.
 *
 * @example
 *   const { rate, loading, error } = useLiveXlmRate();
 *   // rate: number | null — USD price of 1 XLM
 */

import { useEffect, useRef, useState } from 'react';

const CACHE_KEY = 'ste_xlm_rate';

const RATE_API_URL =
  process.env.NEXT_PUBLIC_XLM_RATE_API_URL ||
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd';

const POLL_INTERVAL_MS = parseInt(
  process.env.NEXT_PUBLIC_XLM_RATE_POLL_INTERVAL_MS || String(60 * 1000),
  10,
);

const CACHE_TTL_MS = parseInt(
  process.env.NEXT_PUBLIC_XLM_RATE_CACHE_TTL_MS || String(5 * 60 * 1000),
  10,
);

function readCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { rate, fetchedAt } = JSON.parse(raw);
    if (typeof rate !== 'number' || Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return rate;
  } catch {
    return null;
  }
}

function writeCache(rate) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, fetchedAt: Date.now() }));
  } catch {
    /* localStorage unavailable (private browsing, quota) — non-fatal */
  }
}

async function fetchXlmRate() {
  const res = await fetch(RATE_API_URL);
  if (!res.ok) throw new Error(`XLM rate request failed: ${res.status}`);
  const data = await res.json();
  const rate = data?.stellar?.usd;
  if (typeof rate !== 'number') throw new Error('XLM rate response missing usd price');
  return rate;
}

/**
 * @returns {{ rate: number | null, loading: boolean, error: string | null, refresh: () => void }}
 */
export function useLiveXlmRate() {
  const [rate, setRate] = useState(() => readCache());
  const [loading, setLoading] = useState(rate == null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = async () => {
      try {
        const nextRate = await fetchXlmRate();
        if (!mountedRef.current) return;
        setRate(nextRate);
        setError(null);
        writeCache(nextRate);
      } catch (err) {
        if (!mountedRef.current) return;
        // Keep showing the last known rate (from state or cache) on error.
        setError(err.message);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    load();
    const intervalId = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, []);

  return { rate, loading, error };
}

export default useLiveXlmRate;
