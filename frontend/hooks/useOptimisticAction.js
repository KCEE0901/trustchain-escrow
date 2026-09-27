/**
 * useOptimisticAction
 *
 * Generic optimistic-update helper: layers a hopeful `override` value on top
 * of an authoritative `actualValue` (e.g. server/SWR state) so the UI can
 * reflect the expected outcome of an in-flight action immediately, instead of
 * waiting for the round trip to confirm it.
 *
 * The action itself doesn't have to run inside this hook — `apply`/`revert`
 * are exposed so a caller (or a child component driving the real async work,
 * e.g. a confirmation modal) can trigger the optimistic value at the moment
 * the user commits to the action, and revert it if the action fails.
 *
 * Usage:
 *   const { value, isPending, apply, revert } = useOptimisticAction(escrow.status);
 *   // on action start:  apply('Disputed')
 *   // on action failure: revert()
 *   // on action success: leave it — `settle` below clears it once the
 *   //                     authoritative value catches up (e.g. after a refetch)
 */

import { useState, useEffect, useCallback } from 'react';

export function useOptimisticAction(actualValue) {
  const [override, setOverride] = useState(null);

  // Once the authoritative value matches the optimistic guess, drop the
  // override so subsequent authoritative changes are reflected normally
  // instead of being masked by a stale override.
  useEffect(() => {
    if (override !== null && actualValue === override) {
      setOverride(null);
    }
  }, [actualValue, override]);

  const apply = useCallback((optimisticValue) => {
    setOverride(optimisticValue);
  }, []);

  const revert = useCallback(() => {
    setOverride(null);
  }, []);

  return {
    value: override ?? actualValue,
    isPending: override !== null,
    apply,
    revert,
  };
}

export default useOptimisticAction;
