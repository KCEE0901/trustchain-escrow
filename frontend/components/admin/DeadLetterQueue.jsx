'use client';

/**
 * DeadLetterQueue
 *
 * Admin UI for inspecting and acting on failed BullMQ jobs in the dead-letter
 * queue. Displays job type, failure reason, attempt count, and a collapsible
 * payload preview per job.
 *
 * Actions:
 *   Replay     — re-queues the job via POST /api/admin/queues/dead-letter/:id/replay
 *   Acknowledge — marks the job as reviewed via POST /api/admin/queues/dead-letter/:id/acknowledge
 *                 Acknowledged jobs are visually dimmed to signal they've been handled.
 *
 * Accessibility:
 *   - Table with role="table" for screen readers
 *   - aria-expanded on collapsible payload buttons
 *   - aria-busy during loading; role="status" for polite announcements
 *   - aria-disabled on action buttons during in-flight requests
 *
 * Falls back to mock data when the backend is unreachable so the UI remains
 * demonstrable in offline / dev environments.
 *
 * Implements #233 — Queue Dead-Letter Admin UI
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  CheckCheck,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_JOBS = [
  {
    id: 'dlq-001',
    type: 'webhook.deliver',
    failureReason: 'ECONNREFUSED — target endpoint unreachable after 5 retries',
    attemptsMade: 5,
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    payload: { webhookId: 'wh_abc123', event: 'escrow.completed', targetUrl: 'https://example.com/hook' },
    acknowledged: false,
  },
  {
    id: 'dlq-002',
    type: 'reputation.index',
    failureReason: 'Timeout: Soroban RPC did not respond within 30 s',
    attemptsMade: 3,
    timestamp: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    payload: { escrowId: 'esc_99887', address: 'GABC...XYZ', event: 'MilestoneApproved' },
    acknowledged: false,
  },
  {
    id: 'dlq-003',
    type: 'email.notify',
    failureReason: 'SMTP authentication failure',
    attemptsMade: 5,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    payload: { to: 'user@example.com', subject: 'Milestone approved', templateId: 'milestone_approved' },
    acknowledged: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function JobTypeBadge({ type }) {
  const colour =
    type.startsWith('webhook') ? 'bg-purple-900/40 text-purple-300 border-purple-700/50' :
    type.startsWith('reputation') ? 'bg-blue-900/40 text-blue-300 border-blue-700/50' :
    type.startsWith('email') ? 'bg-amber-900/40 text-amber-300 border-amber-700/50' :
    'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-mono ${colour}`}>
      {type}
    </span>
  );
}

function PayloadPreview({ jobId, payload }) {
  const [open, setOpen] = useState(false);
  const btnId = `payload-btn-${jobId}`;
  const regionId = `payload-region-${jobId}`;

  return (
    <div>
      <button
        id={btnId}
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
        {open ? 'Hide payload' : 'Preview payload'}
      </button>
      <div
        id={regionId}
        role="region"
        aria-labelledby={btnId}
        hidden={!open}
      >
        <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-950 border border-gray-800 p-3 text-[11px] text-gray-300 leading-relaxed">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeadLetterQueue() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inFlight, setInFlight] = useState({}); // jobId → 'replay' | 'acknowledge'
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, variant = 'success') => {
    setToast({ msg, variant });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/queues/dead-letter`, {
        headers: { 'x-admin-api-key': '' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs ?? data);
    } catch {
      // Fall back to mock data so the UI is always demonstrable.
      setJobs(MOCK_JOBS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleAction = useCallback(async (jobId, action) => {
    setInFlight(prev => ({ ...prev, [jobId]: action }));
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/queues/dead-letter/${jobId}/${action}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      if (action === 'acknowledge') {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, acknowledged: true } : j));
        showToast('Job acknowledged.');
      } else {
        setJobs(prev => prev.filter(j => j.id !== jobId));
        showToast('Job re-queued for replay.');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setInFlight(prev => { const n = { ...prev }; delete n[jobId]; return n; });
    }
  }, [showToast]);

  const pendingCount = jobs.filter(j => !j.acknowledged).length;

  return (
    <section aria-labelledby="dlq-heading" aria-busy={loading}>
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-xl
            ${toast.variant === 'error'
              ? 'border-red-500/40 bg-red-900/80 text-red-200'
              : 'border-emerald-500/40 bg-emerald-900/80 text-emerald-100'}`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="dlq-heading" className="text-xl font-bold text-white">
            Dead-Letter Queue
          </h2>
          <p className="mt-0.5 text-sm text-gray-400">
            {loading
              ? 'Loading jobs…'
              : `${pendingCount} unacknowledged job${pendingCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchJobs}
          aria-disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-400"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div aria-hidden="true" className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && jobs.length === 0 && (
        <div className="card py-14 text-center">
          <CheckCheck className="mx-auto mb-3 h-8 w-8 text-emerald-500" aria-hidden="true" />
          <p className="font-medium text-gray-300">Dead-letter queue is empty</p>
          <p className="mt-1 text-sm text-gray-500">All jobs are healthy.</p>
        </div>
      )}

      {/* Jobs table */}
      {!loading && jobs.length > 0 && (
        <div
          role="table"
          aria-label="Dead-letter queue jobs"
          className="space-y-3"
        >
          <div role="rowgroup" className="sr-only">
            <div role="row">
              <span role="columnheader">Job type</span>
              <span role="columnheader">Failure reason</span>
              <span role="columnheader">Attempts</span>
              <span role="columnheader">Time</span>
              <span role="columnheader">Actions</span>
            </div>
          </div>

          <div role="rowgroup" className="space-y-3">
            {jobs.map(job => {
              const busy = !!inFlight[job.id];
              return (
                <div
                  key={job.id}
                  role="row"
                  className={`card transition-opacity ${job.acknowledged ? 'opacity-40' : ''}`}
                  aria-label={`Job ${job.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* Left: type + reason */}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span role="cell">
                          <JobTypeBadge type={job.type} />
                        </span>
                        <span className="text-xs text-gray-600" role="cell">
                          {relativeTime(job.timestamp)}
                        </span>
                        {job.acknowledged && (
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-500">
                            acknowledged
                          </span>
                        )}
                      </div>
                      <p role="cell" className="text-sm text-red-400 leading-snug">
                        {job.failureReason}
                      </p>
                      <p role="cell" className="text-xs text-gray-500">
                        {job.attemptsMade} attempt{job.attemptsMade !== 1 ? 's' : ''} made
                      </p>
                      <PayloadPreview jobId={job.id} payload={job.payload} />
                    </div>

                    {/* Right: actions */}
                    <div role="cell" className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        aria-label={`Replay job ${job.id}`}
                        aria-disabled={busy || job.acknowledged}
                        disabled={busy || job.acknowledged}
                        onClick={() => handleAction(job.id, 'replay')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-700/50 bg-indigo-900/30 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-800/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Replay
                      </button>
                      {!job.acknowledged && (
                        <button
                          type="button"
                          aria-label={`Acknowledge job ${job.id}`}
                          aria-disabled={busy}
                          disabled={busy}
                          onClick={() => handleAction(job.id, 'acknowledge')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
