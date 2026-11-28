'use client';

import { useState } from 'react';

export default function ExpiryExtensionRequest({ escrowId, eligible = true, onRequest }) {
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');

  if (!eligible) {
    return (
      <div className="card border-gray-800">
        <p className="text-sm text-gray-400">Expiry extension is not available for this escrow.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-300">
        Expiry Extension
      </h2>
      <div className="grid gap-3 md:grid-cols-[120px_1fr_auto]">
        <input
          type="number"
          min="1"
          max="90"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
          aria-label="Extension days"
        />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for extension"
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
        />
        <button
          type="button"
          disabled={!reason.trim()}
          onClick={() => onRequest?.({ escrowId, days: Number(days), reason })}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Request
        </button>
      </div>
    </div>
  );
}
