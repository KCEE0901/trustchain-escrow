'use client';

import { useCallback } from 'react';
import useSWR from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const fetcher = (url) => fetch(url).then((r) => r.json());

/**
 * Fetch a single escrow by ID.
 * Polls every 30 seconds; pauses automatically when the page is hidden.
 *
 * @param {number|string} id — escrow_id
 * @returns {{ escrow: object|null, isLoading: boolean, error: Error|null, mutate: Function }}
 */
export function useEscrow(id) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `${API_URL}/api/escrows/${id}` : null,
    fetcher,
    {
      refreshInterval: 30_000, // poll every 30 seconds
      refreshWhenHidden: false, // pause polling when page is not visible
    },
  );
  return { escrow: data, isLoading, error, mutate };
}

/**
 * Fetch all escrows for the connected user.
 *
 * @param {string} address — Stellar public key
 * @param {'client'|'freelancer'|'all'} role
 * @returns {{ escrows: Array, isLoading: boolean, error: Error|null }}
 *
 * TODO (contributor — Issue #39)
 */
export function useUserEscrows(_address, _role = 'all') {
  // TODO: implement with SWR
  return { escrows: [], isLoading: false, error: null };
}

/**
 * Fetch paginated list of all escrows (for Explorer).
 *
 * @param {{ page: number, limit: number, status: string }} options
 *
 * TODO (contributor — Issue #39)
 */
export function useEscrowList({ page: _page = 1, limit: _limit = 20, status: _status = '' } = {}) {
  // TODO: implement with SWR
  return { escrows: [], total: 0, isLoading: false, error: null };
}

/**
 * Keyboard accessibility helper for escrow action controls (approve, release,
 * dispute, cancel, etc). Wires up Enter/Space to activate, Escape to cancel,
 * and leaves Tab to the browser's native focus order so no tabIndex/focus
 * trapping is imposed on the caller.
 *
 * Purely additive — existing onClick handlers keep working unchanged; this
 * hook only supplies an onKeyDown handler that mirrors the same activation
 * semantics for keyboard users.
 *
 * @param {Function} onActivate - Called on Enter or Space (same as onClick).
 * @param {Function} [onCancel] - Called on Escape, if provided.
 * @returns {{ onKeyDown: Function, 'data-keyboard-accessible': boolean }}
 *
 * @example
 * const { onKeyDown } = useKeyboardActivation(handleApprove, handleClose);
 * <div role="button" tabIndex={0} onClick={handleApprove} onKeyDown={onKeyDown}>
 *   Approve
 * </div>
 */
export function useKeyboardActivation(onActivate, onCancel) {
  const onKeyDown = useCallback(
    (event) => {
      switch (event.key) {
        case 'Enter':
        case ' ':
        case 'Spacebar':
          // Prevent the page from scrolling on Space and avoid double-firing
          // when the element is a native <button> (which already handles this).
          event.preventDefault();
          onActivate?.(event);
          break;
        case 'Escape':
        case 'Esc':
          if (onCancel) {
            event.preventDefault();
            onCancel(event);
          }
          break;
        // Tab is intentionally left untouched so native focus order applies.
        default:
          break;
      }
    },
    [onActivate, onCancel],
  );

  return { onKeyDown, 'data-keyboard-accessible': true };
}

/**
 * Returns focus-visible class names for interactive escrow controls so
 * keyboard focus is always visually distinguishable, without altering
 * mouse/touch styling.
 *
 * @param {string} [extra] - Additional class names to merge in.
 * @returns {string} className string with focus-visible ring utilities.
 *
 * @example
 * <button className={useFocusRingClass('rounded-md px-3 py-1')}>Release</button>
 */
export function useFocusRingClass(extra = '') {
  const base =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500';
  return extra ? `${base} ${extra}` : base;
}

/**
 * Builds the standard set of ARIA/keyboard props for a non-native element
 * (e.g. a <div> or <span>) that behaves like a button in an escrow action
 * bar. Native <button>/<a> elements do not need this — they already handle
 * keyboard activation and focus.
 *
 * @param {Object} options
 * @param {Function} options.onActivate - Click/Enter/Space handler.
 * @param {Function} [options.onCancel] - Escape handler.
 * @param {string} [options.label] - Accessible name (aria-label).
 * @param {boolean} [options.disabled] - Whether the control is disabled.
 * @returns {Object} Props to spread onto the element.
 */
export function useAccessibleControlProps({ onActivate, onCancel, label, disabled = false }) {
  const { onKeyDown } = useKeyboardActivation(disabled ? undefined : onActivate, onCancel);
  return {
    role: 'button',
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    'aria-label': label,
    onKeyDown: disabled ? undefined : onKeyDown,
    className: useFocusRingClass(),
  };
}
