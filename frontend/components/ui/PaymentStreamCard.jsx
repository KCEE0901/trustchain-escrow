/**
 * PaymentStreamCard Component
 *
 * Displays a recurring payment stream summary with its status, amount, cadence,
 * and quick action buttons (Pause / Cancel). All interactive elements are fully
 * keyboard-navigable:
 *
 * - The card itself is focusable and triggers `onSelect` on **Enter**.
 * - The "Pause" and "Cancel" action buttons are reachable via **Tab** and
 *   activated with **Enter** or **Space**.
 * - A focused card can be dismissed / deselected with **Escape**.
 * - All focus states use a visible `focus-visible` ring so keyboard users can
 *   always see where focus is.
 *
 * @param {object}   props
 * @param {object}   props.stream                   — Payment stream data object
 * @param {number|string} props.stream.id           — Unique stream identifier
 * @param {string}   props.stream.recipient         — Recipient Stellar address (truncated display)
 * @param {string}   props.stream.amount            — Amount per interval (e.g. "10.00")
 * @param {string}   [props.stream.asset='XLM']     — Asset/token symbol
 * @param {string}   props.stream.interval          — Human-readable cadence (e.g. "weekly", "monthly")
 * @param {'active'|'paused'|'cancelled'|'completed'} props.stream.status — Stream status
 * @param {string}   [props.stream.nextPayment]     — ISO date string for the next scheduled payment
 * @param {string}   [props.stream.totalSent]       — Cumulative amount already sent
 * @param {function} [props.onSelect]               — Called when the card is activated (click / Enter)
 * @param {function} [props.onPause]                — Called when the Pause action is triggered
 * @param {function} [props.onCancel]               — Called when the Cancel action is triggered
 * @param {boolean}  [props.isLoading=false]        — Renders a skeleton placeholder when true
 */

'use client';

import { useRef, useCallback } from 'react';
import { PlayCircle, PauseCircle, XCircle, Clock, ArrowRight } from 'lucide-react';

// ── Status badge colours ───────────────────────────────────────────────────────

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  completed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STATUS_ICONS = {
  active: <PlayCircle size={13} aria-hidden="true" />,
  paused: <PauseCircle size={13} aria-hidden="true" />,
  cancelled: <XCircle size={13} aria-hidden="true" />,
  completed: <ArrowRight size={13} aria-hidden="true" />,
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PaymentStreamCardSkeleton() {
  return (
    <div
      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 animate-pulse"
      aria-busy="true"
      aria-label="Loading payment stream"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>
      <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
      <div className="h-3 w-48 bg-gray-100 dark:bg-gray-800 rounded mb-4" />
      <div className="flex gap-2">
        <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaymentStreamCard({
  stream,
  onSelect,
  onPause,
  onCancel,
  isLoading = false,
}) {
  const cardRef = useRef(null);

  // ── Keyboard handler for the card wrapper ───────────────────────────────────
  const handleCardKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onSelect?.(stream);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Blur the card so the user can navigate away
        cardRef.current?.blur();
      }
    },
    [onSelect, stream],
  );

  // ── Keyboard handler for action buttons ─────────────────────────────────────
  const handleButtonKeyDown = useCallback((handler, payload) => (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation(); // prevent card's own handler firing
      handler?.(payload);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cardRef.current?.focus(); // return focus to the card
    }
  }, []);

  if (isLoading) return <PaymentStreamCardSkeleton />;

  const {
    id,
    recipient,
    amount,
    asset = 'XLM',
    interval,
    status,
    nextPayment,
    totalSent,
  } = stream;

  const normalizedStatus = STATUS_STYLES[status] ? status : 'active';
  const statusStyle = STATUS_STYLES[normalizedStatus];
  const StatusIcon = STATUS_ICONS[normalizedStatus];
  const isActionable = normalizedStatus === 'active' || normalizedStatus === 'paused';

  const formattedNextPayment = nextPayment
    ? new Date(nextPayment).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
    <article
      ref={cardRef}
      tabIndex={0}
      role="button"
      aria-label={`Payment stream to ${recipient}, ${amount} ${asset} ${interval}. Status: ${normalizedStatus}. Press Enter to view details.`}
      onClick={() => onSelect?.(stream)}
      onKeyDown={handleCardKeyDown}
      className={[
        'rounded-xl border bg-white dark:bg-gray-900 p-4 transition-all duration-200',
        'cursor-pointer select-none',
        'hover:border-indigo-300 dark:hover:border-indigo-700 hover:-translate-y-0.5 hover:shadow-md dark:hover:shadow-black/30',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
        normalizedStatus === 'cancelled' || normalizedStatus === 'completed'
          ? 'border-gray-200 dark:border-gray-800 opacity-75'
          : 'border-gray-200 dark:border-gray-800',
      ].join(' ')}
    >
      {/* ── Header row ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Recipient</p>
          <p
            className="font-mono text-sm text-gray-900 dark:text-white truncate"
            title={recipient}
          >
            {recipient}
          </p>
        </div>

        {/* Status badge */}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusStyle}`}
        >
          {StatusIcon}
          {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
        </span>
      </div>

      {/* ── Amount and cadence ────────────────────────────────────────────── */}
      <div className="mb-3">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">
          {amount}{' '}
          <span className="text-base font-semibold text-gray-500 dark:text-gray-400">{asset}</span>
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">per {interval}</p>
      </div>

      {/* ── Meta row ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
        {formattedNextPayment && (
          <span className="flex items-center gap-1">
            <Clock size={11} aria-hidden="true" />
            Next: {formattedNextPayment}
          </span>
        )}
        {totalSent != null && (
          <span>
            Total sent:{' '}
            <span className="text-gray-700 dark:text-gray-300 font-medium">
              {totalSent} {asset}
            </span>
          </span>
        )}
        <span className="text-gray-400 dark:text-gray-600">#{id}</span>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      {isActionable && (
        <div className="flex gap-2" role="group" aria-label="Stream actions">
          {/* Pause / Resume */}
          <button
            type="button"
            tabIndex={0}
            aria-label={
              normalizedStatus === 'paused'
                ? `Resume payment stream to ${recipient}`
                : `Pause payment stream to ${recipient}`
            }
            onClick={(e) => {
              e.stopPropagation();
              onPause?.(stream);
            }}
            onKeyDown={handleButtonKeyDown(onPause, stream)}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
              'transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-1',
              normalizedStatus === 'paused'
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
                : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:hover:bg-yellow-900/50',
            ].join(' ')}
          >
            {normalizedStatus === 'paused' ? (
              <>
                <PlayCircle size={14} aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <PauseCircle size={14} aria-hidden="true" />
                Pause
              </>
            )}
          </button>

          {/* Cancel */}
          <button
            type="button"
            tabIndex={0}
            aria-label={`Cancel payment stream to ${recipient}`}
            onClick={(e) => {
              e.stopPropagation();
              onCancel?.(stream);
            }}
            onKeyDown={handleButtonKeyDown(onCancel, stream)}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
              'transition-colors duration-150',
              'bg-red-100 text-red-700 hover:bg-red-200',
              'dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1',
            ].join(' ')}
          >
            <XCircle size={14} aria-hidden="true" />
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}
