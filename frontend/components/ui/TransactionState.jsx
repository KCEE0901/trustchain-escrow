'use client';

import { CheckCircle, XCircle } from 'lucide-react';

const CONFIG = {
  success: {
    Icon: CheckCircle,
    title: 'Transaction confirmed',
    classes: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    ring: 'bg-emerald-500/20 text-emerald-300 animate-tx-success',
  },
  failure: {
    Icon: XCircle,
    title: 'Transaction failed',
    classes: 'border-red-500/40 bg-red-500/10 text-red-300',
    ring: 'bg-red-500/20 text-red-300 animate-tx-failure',
  },
};

export default function TransactionState({ state, title, message, txHash }) {
  if (!state || !CONFIG[state]) return null;

  const { Icon, title: fallbackTitle, classes, ring } = CONFIG[state];

  return (
    <div
      className={`rounded-2xl border p-4 text-left shadow-lg ${classes}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className={`rounded-full p-2 ${ring}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-white">{title || fallbackTitle}</p>
          {message && <p className="text-sm leading-relaxed">{message}</p>}
          {txHash && (
            <p className="break-all text-xs text-gray-400">
              Transaction hash: <span className="text-gray-200">{txHash}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
