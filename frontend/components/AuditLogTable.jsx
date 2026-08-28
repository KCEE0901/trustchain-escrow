'use client';

/**
 * AuditLogTable — fetches and renders an audit log for an escrow or globally.
 *
 * Surfaces contextual error messages that include the HTTP status code and a
 * user-facing hint rather than a generic "Internal error" fallback. Shows a
 * skeleton while loading and a clear empty state when the log is blank.
 *
 * @param {object}  props
 * @param {string}  [props.escrowId]  - Escrow ID; omit to load the global admin audit log.
 * @param {string}  [props.className] - Additional Tailwind classes for the root element.
 */

import { useEffect, useId, useState } from 'react';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/Skeleton';

// ── Error message helpers ────────────────────────────────────────────────────

/**
 * Map an HTTP status code or error type to a user-facing hint.
 *
 * @param {number|null} status
 * @returns {{ summary: string, hint: string }}
 */
function buildErrorMessage(status) {
  if (status === null) {
    return {
      summary: 'Network error',
      hint: 'Could not reach the server. Check your connection and try again.',
    };
  }
  if (status === 401) {
    return {
      summary: `Server returned ${status}`,
      hint: 'Your session may have expired. Please sign in again.',
    };
  }
  if (status === 403) {
    return {
      summary: `Server returned ${status}`,
      hint: 'You do not have permission to view this audit log.',
    };
  }
  if (status === 404) {
    return {
      summary: `Server returned ${status}`,
      hint: 'The requested audit log was not found. The escrow ID may be incorrect.',
    };
  }
  if (status >= 500) {
    return {
      summary: `Server returned ${status}`,
      hint: 'An unexpected server error occurred. Please try again in a moment.',
    };
  }
  return {
    summary: `Server returned ${status}`,
    hint: 'An unexpected error occurred. Please try again.',
  };
}

// ── Skeleton rows ────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-2">
          <Skeleton className="h-4 w-36 shrink-0" />
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-4 w-32 shrink-0" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AuditLogTable({ escrowId, className }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { summary, hint } | null
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const url = escrowId
        ? `/api/v1/escrows/${escrowId}/audit-log`
        : '/api/v1/admin/audit-log';

      try {
        const res = await fetch(url);

        if (!res.ok) {
          const { summary, hint } = buildErrorMessage(res.status);
          if (!cancelled) {
            setError({ summary, hint });
            setLoading(false);
          }
          return;
        }

        const json = await res.json();
        if (!cancelled) {
          setEntries(json.entries ?? json ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          const { summary, hint } = buildErrorMessage(null);
          setError({ summary, hint });
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [escrowId]);

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section
        aria-labelledby={headingId}
        aria-busy="true"
        className={cn(
          'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden',
          className,
        )}
      >
        <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
          <h3
            id={headingId}
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Audit Log
          </h3>
        </div>
        <div className="py-3">
          <TableSkeleton />
        </div>
      </section>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <section
        aria-labelledby={headingId}
        className={cn(
          'rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 overflow-hidden',
          className,
        )}
      >
        <div className="border-b border-red-100 dark:border-red-900 px-4 py-3">
          <h3
            id={headingId}
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Audit Log
          </h3>
        </div>
        <div className="px-4 py-6" role="alert">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Failed to load audit log — {error.summary}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{error.hint}</p>
        </div>
      </section>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <section
        aria-labelledby={headingId}
        className={cn(
          'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden',
          className,
        )}
      >
        <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
          <h3
            id={headingId}
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Audit Log
          </h3>
        </div>
        <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No audit log entries yet.
        </p>
      </section>
    );
  }

  // ── Data table ─────────────────────────────────────────────────────────────

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden',
        className,
      )}
    >
      <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3">
        <h3
          id={headingId}
          className="text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          Audit Log
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">
            {escrowId ? `Audit log for escrow ${escrowId}` : 'Global admin audit log'}
          </caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th
                scope="col"
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Timestamp
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Actor
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Action
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((entry) => (
              <tr
                key={entry.id ?? `${entry.createdAt}-${entry.action}`}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  <time dateTime={entry.createdAt}>
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleString()
                      : '—'}
                  </time>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-nowrap">
                  {entry.actor ?? '—'}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                    {entry.action ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate">
                  {entry.details ?? entry.metadata
                    ? JSON.stringify(entry.details ?? entry.metadata)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
