'use client';

/**
 * StaleIndexerWarning
 *
 * Renders an amber alert banner when the Stellar event indexer lags ≥
 * LAG_THRESHOLD ledgers behind the live network. Hidden when lag is within
 * the healthy range or while data is still being loaded.
 *
 * The banner is dismissible; it reappears automatically when the lag
 * worsens past the threshold after a dismissal (i.e. if the lag becomes
 * healthy and then deteriorates again, the banner re-shows).
 *
 * Accessibility:
 *   - role="alert" so assistive technology announces it immediately on
 *     mount, which is appropriate for a degraded-service warning.
 *   - Dismiss button carries an aria-label.
 *
 * Props:
 *   status        {{ lastLedger: number, currentLedger: number } | null}
 *                 — indexer status object fetched by the parent. Pass null
 *                   while loading.
 *   lagThreshold  {number} — ledgers behind before the banner shows (default 50)
 *   onDismiss     {function} — optional callback when the user dismisses
 *
 * Implements #234 — Stale Indexer Warning in Explorer
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DEFAULT_LAG_THRESHOLD = 50;

export default function StaleIndexerWarning({
  status,
  lagThreshold = DEFAULT_LAG_THRESHOLD,
  onDismiss,
}) {
  const [dismissed, setDismissed] = useState(false);
  // Track the last lag at which we showed the banner so we can re-show if it worsens.
  const [lastDismissedLag, setLastDismissedLag] = useState(null);

  const lag =
    status && typeof status.currentLedger === 'number' && typeof status.lastLedger === 'number'
      ? status.currentLedger - status.lastLedger
      : null;

  const isStale = lag !== null && lag >= lagThreshold;

  // Re-show the banner if lag worsens past the threshold since the last dismissal.
  useEffect(() => {
    if (isStale && dismissed && lastDismissedLag !== null && lag > lastDismissedLag) {
      setDismissed(false);
    }
  }, [isStale, dismissed, lag, lastDismissedLag]);

  const handleDismiss = () => {
    setDismissed(true);
    setLastDismissedLag(lag);
    onDismiss?.();
  };

  // Don't render while loading (status is null) or if healthy / dismissed.
  if (!isStale || dismissed) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-amber-600/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-300"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
        aria-hidden="true"
      />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-200">
          Indexer may be out of date
        </p>
        <p className="mt-0.5 text-amber-300/80">
          Last processed ledger:{' '}
          <span className="font-mono font-medium text-amber-200">
            {status.lastLedger.toLocaleString()}
          </span>
          {' '}— lagging{' '}
          <span className="font-mono font-medium text-amber-200">
            {lag.toLocaleString()}
          </span>{' '}
          ledger{lag !== 1 ? 's' : ''} behind the live network. Some
          events may not yet be visible. Try again in a few moments.
        </p>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss stale indexer warning"
        className="ml-auto shrink-0 rounded p-0.5 text-amber-400 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 transition-colors"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
