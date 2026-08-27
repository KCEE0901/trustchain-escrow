'use client';

import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const BADGE_THRESHOLDS = {
  ELITE: 1000,
  EXPERT: 500,
  VERIFIED: 250,
  TRUSTED: 100,
};

/**
 * Derives the reputation badge label from a score.
 *
 * Uses strict numeric comparison — score must be a finite number.
 * Passing null, undefined, or NaN returns 'NEW'.
 *
 * @param {number} score
 * @returns {'ELITE'|'EXPERT'|'VERIFIED'|'TRUSTED'|'NEW'}
 */
export function getBadgeFromScore(score) {
  if (typeof score !== 'number' || !isFinite(score)) return 'NEW';
  if (score >= BADGE_THRESHOLDS.ELITE) return 'ELITE';
  if (score >= BADGE_THRESHOLDS.EXPERT) return 'EXPERT';
  if (score >= BADGE_THRESHOLDS.VERIFIED) return 'VERIFIED';
  if (score >= BADGE_THRESHOLDS.TRUSTED) return 'TRUSTED';
  return 'NEW';
}

/**
 * Fetches reputation data for a Stellar address.
 *
 * Null/undefined checks are standardised: every guard uses `=== null` or
 * `=== undefined` (or the combined `value == null`) so the behaviour is
 * explicit and consistent throughout this hook.
 *
 * @param {string|null|undefined} address — Stellar public key
 * @returns {{ reputation: object|null, badge: string, isLoading: boolean, error: Error|null }}
 */
export function useReputation(address) {
  // Consistent null/undefined guard: address == null covers both null and undefined.
  const key = address == null || address === '' ? null : `${API_URL}/api/reputation/${address}`;

  const { data, error, isLoading } = useSWR(key, (url) => fetch(url).then((r) => r.json()), {
    // Reputation changes infrequently — no need to refetch on window focus.
    revalidateOnFocus: false,
    // Keep stale data while revalidating so the badge never flickers to NEW.
    keepPreviousData: true,
  });

  // Derive badge from the fetched score; fall back to 'NEW' when data is null/undefined.
  const score = data?.totalScore ?? null;
  const badge = score !== null ? getBadgeFromScore(Number(score)) : 'NEW';

  return {
    reputation: data !== undefined ? data : null,
    badge,
    isLoading,
    error: error !== undefined ? error : null,
  };
}
