'use client';

import { useEffect, useState } from 'react';
import EmptyState from '../components/ui/EmptyState';

const DEFAULT_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Fetch and track the accrual entries for a payment stream (milestone-based
 * escrow funds releasing over time).
 *
 * @param {string|number|bigint|null|undefined} escrowId
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 * @returns {{
 *   entries: Array<object>,
 *   loading: boolean,
 *   error: Error|null,
 *   isEmpty: boolean,
 *   EmptyStateView: () => JSX.Element|null,
 * }}
 */
export function useStreamAccrual(escrowId, options = {}) {
  const { enabled = true } = options;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled && escrowId));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !escrowId) {
      setEntries([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${DEFAULT_API}/api/escrows/${escrowId}/accrual`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch accrual data (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setEntries(Array.isArray(data?.entries) ? data.entries : []);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [escrowId, enabled]);

  const isEmpty = !loading && !error && entries.length === 0;

  /**
   * Render a friendly empty state when there is no accrual activity yet.
   * Returns null while loading, on error, or when entries are present —
   * callers should handle those states separately.
   */
  function EmptyStateView() {
    if (!isEmpty) return null;
    return (
      <EmptyState
        title="No accrual activity yet"
        description="Funds haven't started streaming for this escrow. Accrual entries will appear here once a milestone begins releasing payment."
        actionLabel="View escrow details"
        actionHref={escrowId ? `/escrow/${escrowId}` : undefined}
      />
    );
  }

  return { entries, loading, error, isEmpty, EmptyStateView };
}

export default useStreamAccrual;
