/**
 * PaymentStreamCard Component
 *
 * Displays a single payment stream with its status, amount, and actions.
 * Fully keyboard-navigable: all interactive elements respond to Enter/Space,
 * the cancel action can be dismissed with Escape, and Tab order follows the
 * natural DOM order within the card.
 *
 * @param {object}  props
 * @param {object}  props.stream
 * @param {string|number} props.stream.id            — unique stream identifier
 * @param {string}  props.stream.recipient           — Stellar address of recipient
 * @param {string}  props.stream.totalAmount         — total amount (XLM or asset)
 * @param {string}  props.stream.releasedAmount      — amount released so far
 * @param {string}  props.stream.status              — 'active' | 'paused' | 'completed' | 'cancelled'
 * @param {string}  [props.stream.assetCode='XLM']   — Stellar asset code
 * @param {string|number} [props.stream.startDate]   — ISO date or timestamp
 * @param {string|number} [props.stream.endDate]     — ISO date or timestamp
 * @param {Function} [props.onPause]   — called with (id) when the Pause button is activated
 * @param {Function} [props.onResume]  — called with (id) when the Resume button is activated
 * @param {Function} [props.onCancel]  — called with (id) when the Cancel button is confirmed
 * @param {Function} [props.onClick]   — called when the card body itself is activated
 */

'use client';

import { useRef, useState, useCallback } from 'react';
import { Pause, Play, X, ChevronRight } from 'lucide-react';

const STATUS_STYLES = {
  active:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  paused:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  completed:
    'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  cancelled:
    'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

const STATUS_LABELS = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatAddress(address) {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function formatDate(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ProgressBar({ released, total, label }) {
  const releasedNum = parseFloat(released) || 0;
  const totalNum = parseFloat(total) || 0;
  const pct = totalNum > 0 ? Math.min(100, Math.round((releasedNum / totalNum) * 100)) : 0;

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>Released</span>
        <span>
          {released} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? `Payment stream progress: ${pct}%`}
        className="w-full h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Small confirmation dialog rendered inline when the user activates Cancel.
 * Dismissible with Escape key; focus is trapped inside until resolved.
 */
function CancelConfirmDialog({ onConfirm, onDismiss }) {
  const confirmRef = useRef(null);
  const dismissRef = useRef(null);

  // Trap Tab inside the dialog
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = [dismissRef.current, confirmRef.current].filter(Boolean);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    },
    [onDismiss],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-confirm-title"
      onKeyDown={handleKeyDown}
      className="mt-3 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
    >
      <p
        id="cancel-confirm-title"
        className="text-sm font-medium text-red-800 dark:text-red-300 mb-2"
      >
        Cancel this payment stream?
      </p>
      <p className="text-xs text-red-700 dark:text-red-400 mb-3">
        This action cannot be undone. Unreleased funds will be returned to the sender.
      </p>
      <div className="flex gap-2">
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-700
                     hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                     dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
          autoFocus
        >
          Keep stream
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white
                     hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Yes, cancel
        </button>
      </div>
    </div>
  );
}

export default function PaymentStreamCard({
  stream,
  onPause,
  onResume,
  onCancel,
  onClick,
}) {
  const {
    id,
    recipient,
    totalAmount,
    releasedAmount,
    status,
    assetCode = 'XLM',
    startDate,
    endDate,
  } = stream;

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const cardRef = useRef(null);

  const isActive = status === 'active';
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed';
  const isCancelled = status === 'cancelled';
  const isInteractive = !isCompleted && !isCancelled;

  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  const statusLabel = STATUS_LABELS[status] ?? status;

  // ── Card body keyboard activation ──────────────────────────────────────────
  const handleCardKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape' && showCancelConfirm) {
        setShowCancelConfirm(false);
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target === cardRef.current) {
        e.preventDefault();
        onClick?.(id);
      }
    },
    [id, onClick, showCancelConfirm],
  );

  // ── Action handlers ────────────────────────────────────────────────────────
  const handlePause = useCallback(
    (e) => {
      e.stopPropagation();
      onPause?.(id);
    },
    [id, onPause],
  );

  const handleResume = useCallback(
    (e) => {
      e.stopPropagation();
      onResume?.(id);
    },
    [id, onResume],
  );

  const handleCancelRequest = useCallback((e) => {
    e.stopPropagation();
    setShowCancelConfirm(true);
  }, []);

  const handleCancelConfirm = useCallback(() => {
    setShowCancelConfirm(false);
    onCancel?.(id);
  }, [id, onCancel]);

  const handleCancelDismiss = useCallback(() => {
    setShowCancelConfirm(false);
    cardRef.current?.focus();
  }, []);

  // ── Keyboard helpers for action buttons ───────────────────────────────────
  const makeButtonKeyDown = (handler) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e);
    }
  };

  return (
    <article
      ref={cardRef}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={handleCardKeyDown}
      onClick={onClick ? () => onClick(id) : undefined}
      aria-label={`Payment stream to ${formatAddress(recipient)} — ${statusLabel}`}
      className={[
        'rounded-xl border bg-white dark:bg-gray-900 p-4 shadow-sm',
        'border-gray-200 dark:border-gray-800',
        'transition-shadow duration-200',
        onClick
          ? 'cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Recipient</p>
          <p
            className="text-sm font-mono font-medium text-gray-900 dark:text-white truncate"
            title={recipient}
          >
            {formatAddress(recipient)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Status badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusStyle}`}
          >
            {statusLabel}
          </span>

          {/* Chevron for clickable cards */}
          {onClick && (
            <ChevronRight
              size={16}
              className="text-gray-400 dark:text-gray-600"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* ── Amount ─────────────────────────────────────────────────────────── */}
      <div className="mb-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Total amount</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">
          {totalAmount}{' '}
          <span className="text-sm font-normal text-gray-500 dark:text-gray-400">{assetCode}</span>
        </p>
      </div>

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      <div className="mb-3">
        <ProgressBar
          released={releasedAmount}
          total={totalAmount}
          label={`Payment stream progress: ${releasedAmount} of ${totalAmount} ${assetCode} released`}
        />
      </div>

      {/* ── Dates ──────────────────────────────────────────────────────────── */}
      {(startDate || endDate) && (
        <div className="flex gap-4 mb-4 text-xs text-gray-500 dark:text-gray-400">
          {startDate && (
            <span>
              Start: <span className="text-gray-700 dark:text-gray-300">{formatDate(startDate)}</span>
            </span>
          )}
          {endDate && (
            <span>
              End: <span className="text-gray-700 dark:text-gray-300">{formatDate(endDate)}</span>
            </span>
          )}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      {isInteractive && (
        <div
          className="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-800"
          role="group"
          aria-label="Stream actions"
        >
          {/* Pause / Resume */}
          {isActive && onPause && (
            <button
              type="button"
              onClick={handlePause}
              onKeyDown={makeButtonKeyDown(handlePause)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                         border border-amber-300 bg-amber-50 text-amber-800
                         hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500
                         dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
              aria-label="Pause payment stream"
            >
              <Pause size={13} aria-hidden="true" />
              Pause
            </button>
          )}

          {isPaused && onResume && (
            <button
              type="button"
              onClick={handleResume}
              onKeyDown={makeButtonKeyDown(handleResume)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                         border border-emerald-300 bg-emerald-50 text-emerald-800
                         hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                         dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
              aria-label="Resume payment stream"
            >
              <Play size={13} aria-hidden="true" />
              Resume
            </button>
          )}

          {/* Cancel */}
          {onCancel && !showCancelConfirm && (
            <button
              type="button"
              onClick={handleCancelRequest}
              onKeyDown={makeButtonKeyDown(handleCancelRequest)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                         border border-red-200 bg-red-50 text-red-700
                         hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
                         dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40
                         ml-auto"
              aria-label="Cancel payment stream"
              aria-haspopup="dialog"
              aria-expanded={showCancelConfirm}
            >
              <X size={13} aria-hidden="true" />
              Cancel
            </button>
          )}
        </div>
      )}

      {/* ── Cancel confirmation dialog ─────────────────────────────────────── */}
      {showCancelConfirm && (
        <CancelConfirmDialog
          onConfirm={handleCancelConfirm}
          onDismiss={handleCancelDismiss}
        />
      )}
    </article>
  );
}
