'use client';

/**
 * KYC Admin Dashboard — /kyc/admin
 *
 * Lists all KYC verification records with status filtering.
 * TODO (contributor): protect this route with admin auth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import { useAuth } from '../../../hooks/useAuth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const STATUSES = ['', 'Pending', 'Init', 'Processing', 'Approved', 'Declined'];

// Actions that mutate a KYC record. Gated by role + record state.
const ACTIONS = [
  { id: 'approve', label: 'Approve', targetStatus: 'Approved' },
  { id: 'decline', label: 'Decline', targetStatus: 'Declined' },
];

// Statuses from which a record can still be acted on.
const ACTIONABLE_STATUSES = new Set(['Pending', 'Init', 'Processing']);

/**
 * Privacy-safe telemetry. Emits only coarse, non-identifying fields:
 * action id, outcome, role category and a duration bucket. Never includes
 * wallet addresses, applicant ids, reject labels or any KYC payload.
 */
export function emitTelemetry({ action, outcome, role, durationMs }) {
  const bucket =
    durationMs < 250 ? 'fast' : durationMs < 1000 ? 'normal' : 'slow';
  const payload = {
    event: 'kyc_admin_action',
    action: String(action),
    outcome: String(outcome),
    role: role === 'admin' ? 'admin' : 'viewer',
    durationBucket: bucket,
  };
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('kyc-admin-telemetry', { detail: payload }));
    }
  } catch {
    // Telemetry must never break the UI.
  }
  return payload;
}

/**
 * SSR-safe reduced-motion detection. Returns false during SSR and the first
 * client render, then reflects the user preference.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(Boolean(mql.matches));
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(update);
      return () => mql.removeListener(update);
    }
    return undefined;
  }, []);

  return reduced;
}

// Deterministic date formatting so snapshots are stable across locales/timezones.
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function KycAdminPage() {
  const { isAuthenticated, role } = useAuth();
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const reducedMotion = usePrefersReducedMotion();
  const actionStartRef = useRef(0);

  const isAdmin = Boolean(isAuthenticated) && role === 'admin';

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page, limit: 20 });
    if (statusFilter) params.set('status', statusFilter);

    let cancelled = false;
    fetch(`${API_BASE}/api/kyc/admin?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error('request_failed');
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setRecords(d.data ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setRecords([]);
        setTotal(0);
        setError('Unable to load KYC records.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, statusFilter]);

  const runAction = useCallback(
    async (record, action) => {
      if (!isAdmin || pendingAction) return;
      if (!ACTIONABLE_STATUSES.has(record.status)) return;
      setPendingAction({ id: record.id, action: action.id });
      actionStartRef.current = Date.now();
      try {
        const res = await fetch(`${API_BASE}/api/kyc/admin/${record.id}/${action.id}`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('action_failed');
        setRecords((prev) =>
          prev.map((r) => (r.id === record.id ? { ...r, status: action.targetStatus } : r)),
        );
        emitTelemetry({
          action: action.id,
          outcome: 'success',
          role: isAdmin ? 'admin' : 'viewer',
          durationMs: Date.now() - actionStartRef.current,
        });
      } catch {
        emitTelemetry({
          action: action.id,
          outcome: 'error',
          role: isAdmin ? 'admin' : 'viewer',
          durationMs: Date.now() - actionStartRef.current,
        });
      } finally {
        setPendingAction(null);
      }
    },
    [isAdmin, pendingAction],
  );

  const transitionClass = reducedMotion
    ? 'transition-none'
    : 'transition-colors';

  const actionButtonClass = useMemo(
    () =>
      `px-2 py-1 rounded text-xs font-medium border ${transitionClass} ` +
      'disabled:opacity-40 disabled:cursor-not-allowed',
    [transitionClass],
  );

  if (!isAuthenticated) {
    return (
      <div
        className="space-y-6"
        data-testid="kyc-admin-unauthorized"
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
      >
        <h1 className="text-2xl font-bold text-white">KYC Admin</h1>
        <p className="text-gray-500 text-center py-12">
          You must be signed in to view KYC records.
        </p>
      </div>
    );
  }

  return (
    <div
      className="space-y-6"
      data-testid="kyc-admin-page"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-role={isAdmin ? 'admin' : 'viewer'}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">KYC Admin</h1>
        <p className="text-gray-400 text-sm">{total} total records</p>
      </div>

      {!isAdmin && (
        <p
          className="text-amber-400 text-sm"
          role="status"
          data-testid="kyc-admin-readonly-notice"
        >
          Read-only view — admin role required to review records.
        </p>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${transitionClass} ${
              statusFilter === s
                ? 'bg-indigo-500 border-indigo-500 text-white'
                : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <p className="text-red-400 text-center py-12" role="alert">
          {error}
        </p>
      ) : records.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No records found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-3 pr-4">Address</th>
                <th className="pb-3 pr-4">Applicant ID</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Result</th>
                <th className="pb-3 pr-4">Updated</th>
                <th className="pb-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {records.map((r) => {
                const actionable = ACTIONABLE_STATUSES.has(r.status);
                const disabledReason = !isAdmin
                  ? 'Admin role required'
                  : !actionable
                    ? 'Record already finalized'
                    : null;
                return (
                  <tr key={r.id} className="text-gray-300">
                    <td className="py-3 pr-4 font-mono text-xs">
                      {r.address.slice(0, 8)}…{r.address.slice(-6)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-500">
                      {r.applicantId ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge status={r.status} size="sm" />
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-500">
                      {r.reviewResult ?? '—'}
                      {r.rejectLabels?.length > 0 && (
                        <span className="ml-1 text-red-400">({r.rejectLabels.join(', ')})</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-500">
                      {formatDate(r.updatedAt)}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        {ACTIONS.map((action) => {
                          const busy =
                            pendingAction?.id === r.id && pendingAction?.action === action.id;
                          return (
                            <button
                              key={action.id}
                              type="button"
                              disabled={Boolean(disabledReason) || Boolean(pendingAction)}
                              title={disabledReason ?? undefined}
                              aria-label={
                                disabledReason
                                  ? `${action.label} unavailable: ${disabledReason}`
                                  : `${action.label} record`
                              }
                              onClick={() => runAction(r, action)}
                              className={actionButtonClass}
                              data-testid={`kyc-action-${action.id}`}
                            >
                              {busy ? '…' : action.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 20 && (
        <div className="flex gap-3 justify-center">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className={`px-4 py-1.5 rounded border border-gray-700 text-gray-400 disabled:opacity-40 text-sm ${transitionClass}`}
          >
            Previous
          </button>
          <span className="text-gray-500 text-sm self-center">Page {page}</span>
          <button
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
            className={`px-4 py-1.5 rounded border border-gray-700 text-gray-400 disabled:opacity-40 text-sm ${transitionClass}`}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
