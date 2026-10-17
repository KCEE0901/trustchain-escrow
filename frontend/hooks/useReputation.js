/**
 * useReputation Hook
 *
 * Fetches reputation data for a Stellar address from the backend API.
 *
 * Usage:
 *   const { reputation, badge, isLoading, error, reducedMotion } = useReputation(address);
 *
 * Uses SWR-style caching semantics (revalidateOnFocus: false) since reputation
 * changes infrequently. Includes stale-request cancellation so older responses
 * can never overwrite newer state after navigation or retries.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const BADGE_THRESHOLDS = {
  ELITE: 1000,
  EXPERT: 500,
  VERIFIED: 250,
  TRUSTED: 100,
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const DEFAULT_ERROR_MESSAGE = 'Failed to load reputation data.';
const ABORTED_ERROR_MESSAGE = 'Reputation request was cancelled.';

/**
 * Derives the reputation badge label from a score.
 *
 * @param {number} score
 * @returns {'ELITE'|'EXPERT'|'VERIFIED'|'TRUSTED'|'NEW'}
 */
export function getBadgeFromScore(score) {
  if (score >= BADGE_THRESHOLDS.ELITE) return 'ELITE';
  if (score >= BADGE_THRESHOLDS.EXPERT) return 'EXPERT';
  if (score >= BADGE_THRESHOLDS.VERIFIED) return 'VERIFIED';
  if (score >= BADGE_THRESHOLDS.TRUSTED) return 'TRUSTED';
  return 'NEW';
}

/**
 * Builds a deterministic, secret-free error from an arbitrary thrown value.
 *
 * @param {unknown} cause
 * @returns {Error}
 */
function sanitizeError(cause) {
  const message =
    cause && typeof cause === 'object' && typeof cause.message === 'string' && cause.message
      ? cause.message
      : DEFAULT_ERROR_MESSAGE;
  const error = new Error(message);
  if (cause && typeof cause === 'object' && typeof cause.name === 'string') {
    error.name = cause.name;
  }
  return error;
}

/**
 * Resolves the reputation endpoint for an address.
 *
 * @param {string} address
 * @returns {string}
 */
function getReputationEndpoint(address) {
  return `/api/reputation/${encodeURIComponent(address)}`;
}

/**
 * Reads the current reduced-motion preference safely (SSR-safe).
 *
 * @returns {boolean}
 */
function getInitialReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Tracks the user's reduced-motion preference.
 *
 * @returns {boolean}
 */
function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(getInitialReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = (event) => {
      setReducedMotion(event.matches);
    };

    setReducedMotion(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    // Legacy Safari fallback.
    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange);
      return () => {
        mediaQuery.removeListener(handleChange);
      };
    }

    return undefined;
  }, []);

  return reducedMotion;
}

/**
 * @param {string|null} address — Stellar public key
 * @returns {{
 *   reputation: object|null,
 *   badge: string,
 *   isLoading: boolean,
 *   error: Error|null,
 *   reducedMotion: boolean,
 * }}
 */
export function useReputation(address) {
  const reducedMotion = useReducedMotion();

  const [reputation, setReputation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Monotonically increasing request id; only the latest id may commit state.
  const requestIdRef = useRef(0);
  // AbortController for the in-flight request, if any.
  const controllerRef = useRef(null);
  // Tracks mount status so late responses never touch unmounted state.
  const mountedRef = useRef(true);

  const cancelInFlight = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelInFlight();
    };
  }, [cancelInFlight]);

  useEffect(() => {
    // Reset state deterministically whenever the address changes.
    setReputation(null);
    setError(null);

    // Abort any previous request and invalidate its id.
    cancelInFlight();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!address) {
      setIsLoading(false);
      return undefined;
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    controllerRef.current = controller;

    setIsLoading(true);

    const isCurrentRequest = () =>
      mountedRef.current && requestIdRef.current === requestId;

    const fetchReputation = async () => {
      try {
        const response = await fetch(getReputationEndpoint(address), {
          signal: controller ? controller.signal : undefined,
          headers: { Accept: 'application/json' },
        });

        if (!isCurrentRequest()) return;

        if (!response.ok) {
          throw new Error(DEFAULT_ERROR_MESSAGE);
        }

        const data = await response.json();

        if (!isCurrentRequest()) return;

        setReputation(data ?? null);
        setError(null);
        setIsLoading(false);
      } catch (cause) {
        if (!isCurrentRequest()) return;

        // Aborted requests are expected during navigation/retries; ignore them.
        if (cause && (cause.name === 'AbortError' || cause.name === 'CanceledError')) {
          return;
        }

        setReputation(null);
        setError(sanitizeError(cause));
        setIsLoading(false);
      }
    };

    fetchReputation();

    return () => {
      if (controller) {
        controller.abort();
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [address, cancelInFlight]);

  const badge = getBadgeFromScore(
    reputation && typeof reputation.score === 'number' ? reputation.score : 0
  );

  return {
    reputation,
    badge,
    isLoading,
    error,
    reducedMotion,
  };
}

export { ABORTED_ERROR_MESSAGE, DEFAULT_ERROR_MESSAGE, REDUCED_MOTION_QUERY };
export default useReputation;