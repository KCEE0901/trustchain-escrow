/**
 * useReputation Hook
 *
 * Fetches reputation data for a Stellar address from the backend API.
 *
 * Usage:
 *   const { reputation, badge, isLoading } = useReputation(address);
 *
 * TODO (contributor — medium, Issue #39):
 * Implement with SWR — similar pattern to useEscrow.
 * Cache aggressively (revalidateOnFocus: false) since reputation
 * changes infrequently.
 *
 * Telemetry: register a reporter with setReputationTelemetryReporter() to
 * receive one privacy-safe event per lookup. Events never contain the wallet
 * address, the reputation payload or error messages.
 */

'use client';

import { useEffect } from 'react';

const BADGE_THRESHOLDS = {
  ELITE: 1000,
  EXPERT: 500,
  VERIFIED: 250,
  TRUSTED: 100,
};

/**
 * Derives the reputation badge label from a score.
 *
 * @param {number} score
 * @returns {'ELITE'|'EXPERT'|'VERIFIED'|'TRUSTED'|'NEW'}
 *
 * TODO (contributor — easy, Issue #39): implement thresholds
 */
export function getBadgeFromScore(score) {
  if (score >= BADGE_THRESHOLDS.ELITE) return 'ELITE';
  if (score >= BADGE_THRESHOLDS.EXPERT) return 'EXPERT';
  if (score >= BADGE_THRESHOLDS.VERIFIED) return 'VERIFIED';
  if (score >= BADGE_THRESHOLDS.TRUSTED) return 'TRUSTED';
  return 'NEW';
}

/**
 * @param {string|null} address — Stellar public key
 * @returns {{ reputation: object|null, badge: string, isLoading: boolean, error: Error|null }}
 *
 * TODO (contributor — Issue #39): replace stub with SWR fetch
 */
export function useReputation(address) {
  // TODO: implement
  const result = {
    reputation: null,
    badge: 'NEW',
    isLoading: false,
    error: address ? new Error('useReputation not implemented — see Issue #39') : null,
  };

  const { outcome, badge, errorCode, hasData } = buildReputationTelemetry({
    address,
    reputation: result.reputation,
    error: result.error,
    isLoading: result.isLoading,
  });

  useEffect(() => {
    if (outcome === 'skipped' || outcome === 'loading') return;
    reportReputationTelemetry({
      event: REPUTATION_TELEMETRY_EVENT,
      outcome,
      badge,
      errorCode,
      hasData,
    });
    // `address` re-reports when the user looks up someone else; it is never
    // part of the payload.
  }, [address, outcome, badge, errorCode, hasData]);

  return result;
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

export const REPUTATION_TELEMETRY_EVENT = 'reputation.fetch';

let telemetryReporter = null;

/**
 * Registers the function that receives reputation telemetry events, or
 * removes it when given anything other than a function. No reporter is
 * registered by default, so nothing is sent unless the app opts in.
 *
 * @param {((event: object) => void)|null} reporter
 */
export function setReputationTelemetryReporter(reporter) {
  telemetryReporter = typeof reporter === 'function' ? reporter : null;
}

/**
 * Maps an error to a fixed code. The message is never used as a value, since
 * it may contain the address or response body.
 *
 * @param {unknown} error
 * @returns {'not_implemented'|'timeout'|'network'|'http_4xx'|'http_5xx'|'unknown'}
 */
export function classifyReputationError(error) {
  if (!error || typeof error !== 'object') return 'unknown';
  const status = Number(error.status ?? error.response?.status);
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500 && status < 600) return 'http_5xx';
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
  if (error.name === 'TypeError') return 'network';
  if (typeof error.message === 'string' && /not implemented/i.test(error.message)) {
    return 'not_implemented';
  }
  return 'unknown';
}

/**
 * Builds the telemetry event for one reputation lookup. The result depends
 * only on its inputs and holds no address, score or raw payload: just the
 * outcome, the derived badge tier and a fixed error code.
 *
 * @param {{ address?: string|null, reputation?: object|null, error?: unknown, isLoading?: boolean }} input
 * @returns {{ event: string, outcome: 'skipped'|'loading'|'success'|'error', badge: string, errorCode: string|null, hasData: boolean }}
 */
export function buildReputationTelemetry({ address, reputation, error, isLoading } = {}) {
  const base = { event: REPUTATION_TELEMETRY_EVENT, badge: 'NEW', errorCode: null, hasData: false };
  if (!address) return { ...base, outcome: 'skipped' };
  if (error) return { ...base, outcome: 'error', errorCode: classifyReputationError(error) };
  if (isLoading) return { ...base, outcome: 'loading' };

  const score = Number(reputation?.total_score ?? reputation?.totalScore ?? reputation?.score);
  return {
    ...base,
    outcome: 'success',
    badge: getBadgeFromScore(Number.isFinite(score) ? score : 0),
    hasData: reputation != null,
  };
}

/**
 * Sends an event to the registered reporter. Reporter failures are swallowed
 * so telemetry can never break the hook.
 *
 * @param {object} event
 * @returns {boolean} whether a reporter accepted the event
 */
export function reportReputationTelemetry(event) {
  if (!telemetryReporter) return false;
  try {
    telemetryReporter(event);
    return true;
  } catch {
    return false;
  }
}
