'use client';

/**
 * LedgerReconciliationTable Component & Utilities
 *
 * Renders an interactive audit reconciliation table comparing off-chain database
 * transactions with Stellar ledger state, highlighting discrepancies and export options.
 *
 * @module components/LedgerReconciliationTable
 */

import React, { useState } from 'react';

/**
 * @typedef {Object} ReconciliationEntry
 * @property {string} id - Unique entry identifier.
 * @property {string} transactionHash - Stellar ledger transaction hash.
 * @property {number} dbAmount - Transaction amount stored in database.
 * @property {number} ledgerAmount - Verified on-chain Stellar transaction amount.
 * @property {'matched'|'discrepancy'|'pending'} status - Reconciliation status classification.
 * @property {string} timestamp - ISO timestamp of transaction ledger entry.
 */

/**
 * Formats status enum value into human-readable label and Tailwind badge CSS class.
 *
 * @param {'matched'|'discrepancy'|'pending'} status - Reconciliation status value.
 * @returns {{ label: string, className: string }} Object containing formatted label and CSS classes.
 */
export function formatReconciliationStatus(status) {
  switch (status) {
    case 'matched':
      return {
        label: 'Matched',
        className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    case 'discrepancy':
      return { label: 'Discrepancy', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
    case 'pending':
    default:
      return { label: 'Pending', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
  }
}

/**
 * Calculates absolute discrepancy difference between database record and on-chain ledger record.
 *
 * @param {number} [dbAmount=0] - Amount recorded in off-chain database.
 * @param {number} [ledgerAmount=0] - Amount recorded on Stellar blockchain ledger.
 * @returns {number} Absolute difference value, rounded to 4 decimal places.
 */
export function calculateDiscrepancyAmount(dbAmount = 0, ledgerAmount = 0) {
  const diff = Math.abs((Number(dbAmount) || 0) - (Number(ledgerAmount) || 0));
  return Number(diff.toFixed(4));
}

/**
 * Filters array of reconciliation entries based on filter status criterion.
 *
 * @param {ReconciliationEntry[]} [entries=[]] - Array of ledger reconciliation record objects.
 * @param {string} [filterStatus='all'] - Status filter ('all', 'matched', 'discrepancy', 'pending').
 * @returns {ReconciliationEntry[]} Filtered array of reconciliation records.
 */
export function filterLedgerEntries(entries = [], filterStatus = 'all') {
  if (!Array.isArray(entries)) return [];
  if (!filterStatus || filterStatus === 'all') return entries;
  return entries.filter((item) => item.status === filterStatus);
}

/**
 * Renders tabular view comparing database transaction records against Stellar ledger state.
 *
 * @component
 * @param {Object} props - React component props.
 * @param {ReconciliationEntry[]} [props.entries=[]] - Array of ledger reconciliation entries.
 * @param {boolean} [props.isLoading=false] - Loading indicator flag during data fetch.
 * @param {(entry: ReconciliationEntry) => void} [props.onResolve] - Callback invoked to resolve discrepancy.
 * @returns {JSX.Element} Rendered table component.
 */
export default function LedgerReconciliationTable({ entries = [], isLoading = false, onResolve }) {
  const [filter, setFilter] = useState('all');
  const filtered = filterLedgerEntries(entries, filter);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-400 bg-gray-900/50 rounded-xl border border-gray-800 animate-pulse">
        Loading ledger reconciliation data...
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Filter Controls */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-white">Ledger Reconciliation</h3>
        <div className="flex items-center gap-2">
          {['all', 'matched', 'discrepancy', 'pending'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                filter === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table Display */}
      <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/40">
        <table className="w-full text-left text-sm text-gray-300">
          <thead className="bg-gray-800/60 text-xs uppercase text-gray-400 border-b border-gray-800">
            <tr>
              <th className="px-4 py-3 font-medium">Tx Hash</th>
              <th className="px-4 py-3 font-medium">DB Amount</th>
              <th className="px-4 py-3 font-medium">Ledger Amount</th>
              <th className="px-4 py-3 font-medium">Diff</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No reconciliation records found.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => {
                const badge = formatReconciliationStatus(entry.status);
                const diff = calculateDiscrepancyAmount(entry.dbAmount, entry.ledgerAmount);
                return (
                  <tr key={entry.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-indigo-400">
                      {entry.transactionHash
                        ? `${entry.transactionHash.slice(0, 8)}...${entry.transactionHash.slice(-8)}`
                        : 'N/A'}
                    </td>
                    <td className="px-4 py-3 font-mono">${entry.dbAmount}</td>
                    <td className="px-4 py-3 font-mono">${entry.ledgerAmount}</td>
                    <td
                      className={`px-4 py-3 font-mono ${diff > 0 ? 'text-rose-400 font-bold' : 'text-gray-400'}`}
                    >
                      ${diff}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.status === 'discrepancy' && onResolve && (
                        <button
                          type="button"
                          onClick={() => onResolve(entry)}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded hover:bg-indigo-500/10 transition-colors"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
