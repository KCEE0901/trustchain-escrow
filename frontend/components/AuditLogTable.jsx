'use client';

/**
 * AuditLogTable
 *
 * Presentational table for rendering a page of admin audit log entries.
 * Pairs with the admin `/api/admin/audit-logs` endpoint, which returns
 * `{ logs, pagination }`.
 */

import { useMemo } from 'react';

/**
 * Maps an audit log action string to a Tailwind color class set used to
 * badge the action in the table.
 *
 * @param {string} action - Raw action string from the audit log entry (e.g. "USER_BAN").
 * @returns {string} Space-separated Tailwind utility classes for text/background/border color.
 */
export function actionColor(action) {
  if (action?.includes('BAN')) return 'text-red-400 bg-red-500/10 border-red-500/20';
  if (action?.includes('SUSPEND')) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  if (action?.includes('RESOLVE'))
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
}

/**
 * Formats an ISO timestamp for display in the audit log table.
 *
 * @param {string | number | Date} timestamp - Timestamp of the audit log entry.
 * @returns {string} A locale-formatted date/time string, or an empty string if invalid.
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

/**
 * Builds a short human-readable label describing who performed the action.
 *
 * @param {{ actorEmail?: string, actorId?: string }} log - Single audit log entry.
 * @returns {string} The actor's email, falling back to their id, or "system" if neither exists.
 */
export function formatActor(log) {
  return log?.actorEmail || log?.actorId || 'system';
}

/**
 * Renders a table of audit log entries with color-coded action badges.
 *
 * @param {object} props - Component props.
 * @param {Array<{id: string, action: string, actorEmail?: string, actorId?: string, createdAt: string, target?: string}>} props.logs -
 *   List of audit log entries for the current page.
 * @param {boolean} [props.loading] - Whether a fetch for this page is in flight.
 * @returns {JSX.Element} The rendered audit log table.
 */
export default function AuditLogTable({ logs, loading }) {
  const rows = useMemo(() => logs ?? [], [logs]);

  return (
    <table className="w-full text-sm text-left">
      <thead>
        <tr className="border-b border-white/10 text-slate-400">
          <th className="py-2 pr-4">Action</th>
          <th className="py-2 pr-4">Actor</th>
          <th className="py-2 pr-4">Target</th>
          <th className="py-2 pr-4">When</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr>
            <td colSpan={4} className="py-4 text-center text-slate-500">
              Loading…
            </td>
          </tr>
        )}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={4} className="py-4 text-center text-slate-500">
              No audit log entries.
            </td>
          </tr>
        )}
        {!loading &&
          rows.map((log) => (
            <tr key={log.id} className="border-b border-white/5">
              <td className="py-2 pr-4">
                <span className={`rounded border px-2 py-0.5 text-xs ${actionColor(log.action)}`}>
                  {log.action}
                </span>
              </td>
              <td className="py-2 pr-4">{formatActor(log)}</td>
              <td className="py-2 pr-4">{log.target || '—'}</td>
              <td className="py-2 pr-4">{formatTimestamp(log.createdAt)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
