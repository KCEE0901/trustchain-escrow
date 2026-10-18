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
 */

'use client';

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

// ── Action gating ─────────────────────────────────────────────────────────────

/** Reasons an action is hidden or disabled. Stable codes, safe to log. */
export const REPUTATION_GATE_REASONS = Object.freeze({
  NO_SUBJECT: 'no_subject',
  NOT_CONNECTED: 'not_connected',
  NOT_A_PARTY: 'not_a_party',
  SELF: 'self',
  ESCROW_UNKNOWN: 'escrow_unknown',
  ESCROW_NOT_COMPLETED: 'escrow_not_completed',
  ALREADY_RATED: 'already_rated',
  LOADING: 'loading',
});

const allow = () => ({ visible: true, enabled: true, reason: null });
const disable = (reason) => ({ visible: true, enabled: false, reason });
const hide = (reason) => ({ visible: false, enabled: false, reason });

const sameAddress = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a !== '' && a.toUpperCase() === b.toUpperCase();

/**
 * Derives the viewer's role from the escrow record itself, never from a role
 * the caller passes in, so the gates cannot be widened by UI state.
 *
 * @param {string|null} viewerAddress
 * @param {{ clientAddress?: string, freelancerAddress?: string }|null} escrow
 * @returns {'client'|'freelancer'|'observer'}
 */
export function getEscrowRole(viewerAddress, escrow) {
  if (!viewerAddress || !escrow) return 'observer';
  if (sameAddress(viewerAddress, escrow.clientAddress)) return 'client';
  if (sameAddress(viewerAddress, escrow.freelancerAddress)) return 'freelancer';
  return 'observer';
}

/**
 * Decides which reputation actions to show and enable for the connected
 * wallet looking at `subjectAddress`'s reputation in the context of `escrow`.
 *
 * - `refresh`: shown whenever there is a subject; disabled while loading.
 * - `rate`: only shown to a party of the escrow looking at the counterparty;
 *   enabled once the escrow is `Completed` and the viewer has not rated yet.
 *
 * Each gate is `{ visible, enabled, reason }`; `reason` is one of
 * REPUTATION_GATE_REASONS (or null when enabled). The result is a pure
 * function of the inputs and contains no addresses.
 *
 * @param {{
 *   viewerAddress?: string|null,
 *   subjectAddress?: string|null,
 *   escrow?: { status?: string, clientAddress?: string, freelancerAddress?: string }|null,
 *   hasRated?: boolean,
 *   isLoading?: boolean,
 * }} input
 * @returns {{ role: string, refresh: object, rate: object }}
 */
export function getReputationActionGates({
  viewerAddress = null,
  subjectAddress = null,
  escrow = null,
  hasRated = false,
  isLoading = false,
} = {}) {
  const R = REPUTATION_GATE_REASONS;
  const role = getEscrowRole(viewerAddress, escrow);

  if (!subjectAddress) {
    return { role, refresh: hide(R.NO_SUBJECT), rate: hide(R.NO_SUBJECT) };
  }

  const refresh = isLoading ? disable(R.LOADING) : allow();

  let rate;
  if (!viewerAddress) {
    rate = hide(R.NOT_CONNECTED);
  } else if (!escrow) {
    rate = hide(R.ESCROW_UNKNOWN);
  } else if (sameAddress(viewerAddress, subjectAddress)) {
    rate = hide(R.SELF);
  } else if (role === 'observer') {
    rate = hide(R.NOT_A_PARTY);
  } else {
    const counterparty = role === 'client' ? escrow.freelancerAddress : escrow.clientAddress;
    if (!sameAddress(subjectAddress, counterparty)) {
      rate = hide(R.NOT_A_PARTY);
    } else if (escrow.status !== 'Completed') {
      rate = disable(R.ESCROW_NOT_COMPLETED);
    } else if (hasRated) {
      rate = disable(R.ALREADY_RATED);
    } else {
      rate = allow();
    }
  }

  return { role, refresh, rate };
}

/**
 * @param {string|null} address — Stellar public key
 * @returns {{ reputation: object|null, badge: string, isLoading: boolean, error: Error|null }}
 *
 * TODO (contributor — Issue #39): replace stub with SWR fetch
 */
export function useReputation(address) {
  // TODO: implement
  return {
    reputation: null,
    badge: 'NEW',
    isLoading: false,
    error: address ? new Error('useReputation not implemented — see Issue #39') : null,
  };
}
