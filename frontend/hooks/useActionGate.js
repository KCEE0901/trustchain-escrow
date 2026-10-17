'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Privacy-safe interaction telemetry helper.
 *
 * Emits a sanitized event describing the outcome of an action-gate evaluation.
 * The payload is intentionally limited to non-identifying, enumerated values:
 * no wallet addresses, no free-form user input, and no sensitive payloads.
 *
 * @param {string} eventName - Stable, enumerated event name.
 * @param {object} payload - Sanitized, deterministic metadata.
 */
export function trackInteraction(eventName, payload = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const sanitized = {
    event: eventName,
    actionState: payload.actionState ?? 'unknown',
    reason: payload.reason ?? 'unknown',
    role: payload.role ?? 'unknown',
    requiredRole: payload.requiredRole ?? 'unknown',
    escrowStatus: payload.escrowStatus ?? 'unknown',
  };

  try {
    if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(
        new window.CustomEvent('interaction:telemetry', { detail: sanitized }),
      );
    }
  } catch {
    // Telemetry must never break the UI; swallow transport errors.
  }
}

const VALID_STATES = ['enabled', 'disabled', 'hidden'];

/**
 * Normalize a role value into a comparable, non-sensitive token.
 * Missing or empty roles are treated as "no role".
 */
function normalizeRole(role) {
  if (typeof role !== 'string') {
    return null;
  }
  const trimmed = role.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize escrow status into a comparable, non-sensitive token.
 */
function normalizeStatus(status) {
  if (typeof status !== 'string') {
    return null;
  }
  const trimmed = status.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive the authoritative action state from role and escrow status.
 *
 * Rules:
 *  - hidden:   role is missing or not authorized for the required role.
 *  - disabled: escrow status is not in the allowed statuses
 *              (e.g. completed / cancelled / disputed).
 *  - enabled:  only on the primary success path (authorized role + allowed status).
 *
 * @returns {{ allowed: boolean, state: 'enabled'|'disabled'|'hidden', reason: string }}
 */
export function deriveActionState({ role, escrowStatus, requiredRole, allowedStatuses }) {
  const normalizedRole = normalizeRole(role);
  const normalizedRequiredRole = normalizeRole(requiredRole);
  const normalizedStatus = normalizeStatus(escrowStatus);

  // Hide when the role is missing entirely.
  if (!normalizedRole) {
    return { allowed: false, state: 'hidden', reason: 'missing-role' };
  }

  // Hide when the role is not authorized for the required role.
  if (normalizedRequiredRole && normalizedRole !== normalizedRequiredRole) {
    return { allowed: false, state: 'hidden', reason: 'unauthorized-role' };
  }

  // Disable when the escrow status is unknown.
  if (!normalizedStatus) {
    return { allowed: false, state: 'disabled', reason: 'missing-escrow-status' };
  }

  // Disable when the escrow status is not in the allowed set.
  const allowedList = Array.isArray(allowedStatuses)
    ? allowedStatuses.map(normalizeStatus).filter(Boolean)
    : [];

  if (allowedList.length > 0 && !allowedList.includes(normalizedStatus)) {
    return { allowed: false, state: 'disabled', reason: 'escrow-status-not-allowed' };
  }

  // Primary success path.
  return { allowed: true, state: 'enabled', reason: 'ready' };
}

/**
 * Permission-aware action gating hook.
 *
 * Wires the authoritative role + escrow-state checks to the CSS
 * `[data-action-state]` contract and emits privacy-safe telemetry.
 *
 * @param {object} params
 * @param {string} params.role - Current user's role.
 * @param {string} params.escrowStatus - Current escrow status.
 * @param {string} params.requiredRole - Role required to perform the action.
 * @param {string[]} params.allowedStatuses - Escrow statuses on which the action is allowed.
 * @returns {{ allowed: boolean, state: 'enabled'|'disabled'|'hidden', reason: string }}
 */
export function useActionGate({ role, escrowStatus, requiredRole, allowedStatuses } = {}) {
  const result = useMemo(
    () => deriveActionState({ role, escrowStatus, requiredRole, allowedStatuses }),
    [role, escrowStatus, requiredRole, allowedStatuses],
  );

  const lastEmittedRef = useRef(null);

  useEffect(() => {
    const state = VALID_STATES.includes(result.state) ? result.state : 'disabled';
    const signature = `${state}:${result.reason}`;

    // Avoid duplicate telemetry for identical evaluations.
    if (lastEmittedRef.current === signature) {
      return;
    }
    lastEmittedRef.current = signature;

    trackInteraction('action_gate_evaluated', {
      actionState: state,
      reason: result.reason,
      role: normalizeRole(role) ?? 'none',
      requiredRole: normalizeRole(requiredRole) ?? 'none',
      escrowStatus: normalizeStatus(escrowStatus) ?? 'none',
    });
  }, [result.state, result.reason, role, requiredRole, escrowStatus]);

  return result;
}

export default useActionGate;