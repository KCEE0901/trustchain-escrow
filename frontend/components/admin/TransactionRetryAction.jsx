'use client';

import { useState } from 'react';

const RETRYABLE_STATUSES = new Set(['failed_retryable', 'retryable', 'timeout']);

export default function TransactionRetryAction({ transaction, onRetry }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const retryable = RETRYABLE_STATUSES.has(transaction?.status);

  if (!retryable) {
    return (
      <span className="text-xs text-gray-500">
        Retry unavailable{transaction?.failureReason ? `: ${transaction.failureReason}` : ''}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
      >
        Retry
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
      <p className="text-xs text-amber-100">
        Retry only after confirming the transaction has no final successful ledger result.
      </p>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Retry reason"
        className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-white"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-gray-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!reason.trim()}
          onClick={() => onRetry?.({ transactionId: transaction.id, reason })}
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Confirm retry
        </button>
      </div>
    </div>
  );
}
