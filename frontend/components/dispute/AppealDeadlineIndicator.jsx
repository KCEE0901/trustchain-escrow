'use client';

/**
 * AppealDeadlineIndicator
 *
 * Shows the appeal deadline for a resolved dispute with a live countdown
 * timer and a Submit Appeal button.
 *
 * Behaviour:
 *   - Button is disabled when `appealWindowOpen` prop is false OR when the
 *     client-side deadline has already passed.
 *   - A POST to /api/disputes/:disputeId/appeal is issued on click.
 *   - Backend 409 / 422 responses close the appeal window and surface the
 *     server's message inline — no crash.
 *   - Non-deadline errors (network failures, 500s) show an inline error
 *     while keeping the appeal window open.
 *
 * Accessibility:
 *   - Countdown timer is wrapped in a <time> element with a machine-readable
 *     dateTime attribute.
 *   - Inline errors use role="alert" for immediate announcement.
 *   - Button carries aria-disabled (not disabled) so keyboard focus is
 *     preserved when the window closes during an in-flight request.
 *
 * Props:
 *   disputeId       {string|number}  — dispute identifier used in the API call
 *   deadline        {string|Date}    — ISO-8601 deadline or Date object
 *   appealWindowOpen {boolean}       — authoritative server-side flag
 *   onAppealSubmitted {function}     — optional callback on success
 *
 * Implements #235 — Appeal Deadline Indicator in Dispute Views
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ─── Countdown helpers ─────────────────────────────────────────────────────────

function msToCountdown(ms) {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSeconds = Math.floor(ms / 1000);
  return {
    days:    Math.floor(totalSeconds / 86400),
    hours:   Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppealDeadlineIndicator({
  disputeId,
  deadline,
  appealWindowOpen: initialWindowOpen = true,
  onAppealSubmitted,
}) {
  const deadlineDate = deadline instanceof Date ? deadline : new Date(deadline);
  const deadlineMs   = deadlineDate.getTime();

  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, deadlineMs - Date.now()));
  const [windowOpen, setWindowOpen] = useState(initialWindowOpen);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const intervalRef = useRef(null);

  // Live countdown — ticks every second.
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, deadlineMs - Date.now());
      setTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(intervalRef.current);
        setWindowOpen(false);
      }
    };
    intervalRef.current = setInterval(tick, 1000);
    tick(); // run immediately so there's no 1-second blank
    return () => clearInterval(intervalRef.current);
  }, [deadlineMs]);

  // Sync prop changes (e.g. server pushes a window-closed update).
  useEffect(() => {
    setWindowOpen(initialWindowOpen);
  }, [initialWindowOpen]);

  const isExpiredClientSide = timeLeft <= 0;
  const canAppeal = windowOpen && !isExpiredClientSide && !submitted;

  const handleSubmitAppeal = useCallback(async () => {
    if (!canAppeal) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/disputes/${disputeId}/appeal`,
        { method: 'POST' },
      );
      if (res.status === 409 || res.status === 422) {
        const body = await res.json().catch(() => ({}));
        setWindowOpen(false);
        setError(body.message || 'The appeal window has closed.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Unexpected error (HTTP ${res.status})`);
      }
      setSubmitted(true);
      onAppealSubmitted?.();
    } catch (err) {
      // Non-deadline errors — keep the window open.
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [canAppeal, disputeId, onAppealSubmitted]);

  const { days, hours, minutes, seconds } = msToCountdown(timeLeft);

  // ── Success state ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Appeal submitted successfully.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
        <Clock className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
        Appeal deadline
      </div>

      {/* Deadline timestamp */}
      <p className="text-xs text-gray-400">
        Deadline:{' '}
        <time
          dateTime={deadlineDate.toISOString()}
          className="font-mono text-gray-200"
        >
          {deadlineDate.toUTCString()}
        </time>
      </p>

      {/* Countdown */}
      {!isExpiredClientSide && windowOpen ? (
        <div
          className="flex items-center gap-2"
          aria-label={`Time remaining: ${days > 0 ? `${days} days ` : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
        >
          {days > 0 && (
            <CountUnit value={days} label="d" />
          )}
          <CountUnit value={hours}   label="h" />
          <CountUnit value={minutes} label="m" />
          <CountUnit value={seconds} label="s" />
        </div>
      ) : (
        <p className="text-xs font-medium text-red-400">
          {windowOpen === false ? 'Appeal window has closed.' : 'Deadline has passed.'}
        </p>
      )}

      {/* Inline error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-400"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Submit Appeal button */}
      <button
        type="button"
        aria-disabled={!canAppeal || isSubmitting}
        disabled={!canAppeal || isSubmitting}
        onClick={handleSubmitAppeal}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Submitting…
          </>
        ) : (
          'Submit Appeal'
        )}
      </button>
    </div>
  );
}

function CountUnit({ value, label }) {
  return (
    <div className="flex items-baseline gap-0.5">
      <span className="font-mono text-lg font-bold text-white" aria-hidden="true">
        {pad(value)}
      </span>
      <span className="text-xs text-gray-500" aria-hidden="true">{label}</span>
    </div>
  );
}
