/**
 * MilestoneTracker Component
 *
 * Wraps MilestoneList with an error boundary and contextual error messages.
 * When milestone data fails to load or an action throws, the error displayed
 * to the user includes enough context to understand what went wrong and what
 * to do next — instead of a generic "Internal error" message.
 *
 * @param {object}   props
 * @param {Array}    props.milestones       — array of Milestone objects
 * @param {string}   props.escrowId         — escrow ID for error context
 * @param {'client'|'freelancer'|'observer'} props.role
 * @param {boolean}  [props.isLoading]      — show skeleton while loading
 * @param {string|null} [props.fetchError]  — error from the data-fetch layer
 * @param {Function} props.onApprove(id)
 * @param {Function} props.onReject(id)
 * @param {Function} props.onSubmit(id)
 */

'use client';

import { useState, useCallback } from 'react';
import MilestoneList from './MilestoneList';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// ── Error message helpers ─────────────────────────────────────────────────────

/**
 * Map a raw error (string, Error, or unknown) to a user-facing message that
 * includes enough context to diagnose and act on the problem.
 */
function buildErrorMessage(err, context) {
  const base = typeof err === 'string' ? err : err?.message ?? 'Unknown error';

  // Network / fetch errors
  if (
    base.includes('Failed to fetch') ||
    base.includes('NetworkError') ||
    base.includes('ECONNREFUSED')
  ) {
    return `Unable to load milestones for escrow #${context.escrowId}: network error. Check your connection and try again.`;
  }

  // Auth errors
  if (base.includes('401') || base.includes('Unauthorized') || base.includes('403') || base.includes('Forbidden')) {
    return `You do not have permission to view or update milestones for escrow #${context.escrowId}. Please reconnect your wallet.`;
  }

  // Not found
  if (base.includes('404') || base.includes('not found')) {
    return `Escrow #${context.escrowId} was not found. It may have been removed or the ID is incorrect.`;
  }

  // Contract / transaction errors
  if (base.includes('Transaction') || base.includes('contract') || base.includes('XDR')) {
    return `Milestone action failed for escrow #${context.escrowId}: ${base}. Check the transaction and try again.`;
  }

  // Wallet not connected
  if (base.includes('wallet') || base.includes('Freighter') || base.includes('connect')) {
    return `Wallet not connected. Please connect your Freighter wallet to manage milestones for escrow #${context.escrowId}.`;
  }

  // Fallback — include the original message so it is never completely opaque
  return `An error occurred while managing milestones for escrow #${context.escrowId}: ${base}`;
}

// ── Action wrapper ────────────────────────────────────────────────────────────

/**
 * Wraps an action handler (onApprove / onReject / onSubmit) so that any error
 * it throws is caught, contextualized, and surfaced in the UI rather than
 * silently swallowed or shown as a raw stack trace.
 */
function useTrackedAction(fn, escrowId, actionName, setError) {
  return useCallback(
    async (milestoneId) => {
      setError(null);
      try {
        await fn(milestoneId);
      } catch (err) {
        const context = { escrowId, action: actionName, milestoneId };
        const message = buildErrorMessage(
          err?.message
            ? { message: `${actionName} failed: ${err.message}` }
            : `${actionName} failed`,
          context,
        );
        setError(message);
      }
    },
    [fn, escrowId, actionName, setError],
  );
}

// ── Inline error banner ───────────────────────────────────────────────────────

function ErrorBanner({ message, onDismiss }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 p-4 mb-4 rounded-lg border
                 bg-red-50 border-red-200 text-red-800
                 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300"
    >
      <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 transition-colors"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function MilestoneTrackerSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading milestones…">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MilestoneTracker({
  milestones = [],
  escrowId,
  role,
  isLoading = false,
  fetchError = null,
  onApprove,
  onReject,
  onSubmit,
}) {
  const [actionError, setActionError] = useState(null);

  const context = { escrowId };

  const trackedApprove = useTrackedAction(onApprove ?? (() => {}), escrowId, 'Approve milestone', setActionError);
  const trackedReject  = useTrackedAction(onReject  ?? (() => {}), escrowId, 'Reject milestone',  setActionError);
  const trackedSubmit  = useTrackedAction(onSubmit  ?? (() => {}), escrowId, 'Submit milestone',  setActionError);

  // Loading skeleton
  if (isLoading) return <MilestoneTrackerSkeleton />;

  // Fetch-layer error — something went wrong before the component even rendered
  if (fetchError) {
    return (
      <div className="card">
        <ErrorBanner
          message={buildErrorMessage(fetchError, context)}
          onDismiss={null}
        />
        <p className="text-sm text-gray-500 mt-2 flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden="true" />
          Reload the page or contact support if the problem persists.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Action error banner — dismissed by the user */}
      {actionError && (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      )}

      <MilestoneList
        milestones={milestones}
        role={role}
        onApprove={trackedApprove}
        onReject={trackedReject}
        onSubmit={trackedSubmit}
      />
    </div>
  );
}
