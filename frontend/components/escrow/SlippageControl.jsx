'use client';

/**
 * SlippageControl
 *
 * Lets the user set a path-payment slippage tolerance for custom-token
 * (path-payment) escrows. Exposes:
 *   - Three preset buttons: 0.1 %, 0.5 %, 1.0 %
 *   - A custom numeric input with bounds validation (0.01 % – 50 %)
 *   - A live "estimated minimum received" amount
 *   - A high-slippage warning banner when tolerance ≥ 3 %
 *
 * Accessibility:
 *   - Preset buttons use aria-pressed to convey selected state.
 *   - The custom input carries aria-describedby pointing at validation
 *     errors and range hints.
 *   - The warning banner has role="alert" for immediate announcement.
 *
 * Props:
 *   sendAmount    {number}   — amount the user is sending
 *   exchangeRate  {number}   — rate from send asset to receive asset
 *   value         {number}   — current slippage tolerance (%)
 *   onChange      {function(slippage: number)} — controlled update callback
 *   disabled      {boolean}
 *
 * Implements #236 — Path Payment Slippage Controls
 */

import { useState, useId } from 'react';
import { AlertTriangle } from 'lucide-react';

const PRESETS = [
  { value: 0.1, label: '0.1 %' },
  { value: 0.5, label: '0.5 %' },
  { value: 1.0, label: '1.0 %' },
];
const MIN_SLIPPAGE  = 0.01;
const MAX_SLIPPAGE  = 50;
const HIGH_SLIPPAGE = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcMinReceived(sendAmount, exchangeRate, slippagePct) {
  if (!sendAmount || !exchangeRate || slippagePct == null) return null;
  return sendAmount * exchangeRate * (1 - slippagePct / 100);
}

function formatReceived(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SlippageControl({
  sendAmount,
  exchangeRate,
  value,
  onChange,
  disabled = false,
}) {
  const [customInput, setCustomInput] = useState('');
  const [validationError, setValidationError] = useState(null);
  const inputId   = useId();
  const errorId   = useId();
  const hintId    = useId();

  const isHighSlippage = value >= HIGH_SLIPPAGE;
  const minReceived    = calcMinReceived(sendAmount, exchangeRate, value);

  const handlePreset = (preset) => {
    setCustomInput('');
    setValidationError(null);
    onChange(preset);
  };

  const handleCustomChange = (raw) => {
    setCustomInput(raw);
    if (raw === '') {
      setValidationError(null);
      return;
    }
    const num = parseFloat(raw);
    if (isNaN(num)) {
      setValidationError('Enter a valid number.');
      return;
    }
    if (num < MIN_SLIPPAGE) {
      setValidationError(`Minimum slippage is ${MIN_SLIPPAGE} %.`);
      return;
    }
    if (num > MAX_SLIPPAGE) {
      setValidationError(`Maximum slippage is ${MAX_SLIPPAGE} %.`);
      return;
    }
    setValidationError(null);
    onChange(num);
  };

  return (
    <div className="space-y-3">
      {/* Label */}
      <p className="text-sm font-medium text-gray-300">
        Slippage tolerance
      </p>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Slippage tolerance presets">
        {PRESETS.map(({ value: preset, label }) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value === preset && customInput === ''}
            disabled={disabled}
            onClick={() => handlePreset(preset)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
              disabled:cursor-not-allowed disabled:opacity-40
              ${value === preset && customInput === ''
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:text-white'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Custom input — type="text" so jsdom doesn't silently swallow non-numeric chars */}
      <div>
        <label htmlFor={inputId} className="mb-1 block text-xs text-gray-400">
          Custom (%)
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={customInput}
          disabled={disabled}
          onChange={e => handleCustomChange(e.target.value)}
          placeholder={`${MIN_SLIPPAGE} – ${MAX_SLIPPAGE}`}
          aria-describedby={`${errorId} ${hintId}`}
          aria-invalid={!!validationError}
          className={`w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-gray-100
            placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500
            disabled:cursor-not-allowed disabled:opacity-40 transition-colors
            ${validationError ? 'border-red-500' : 'border-gray-700'}`}
        />
        {/* Range hint */}
        <p id={hintId} className="mt-1 text-xs text-gray-500">
          Enter a value between {MIN_SLIPPAGE} % and {MAX_SLIPPAGE} %.
        </p>
        {/* Validation error */}
        {validationError && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-red-400">
            {validationError}
          </p>
        )}
      </div>

      {/* Estimated minimum received */}
      {sendAmount > 0 && exchangeRate > 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm">
          <span className="text-gray-400">Estimated minimum received: </span>
          <span className="font-mono font-medium text-gray-100">
            {formatReceived(minReceived)}
          </span>
        </div>
      )}

      {/* High-slippage warning */}
      {isHighSlippage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
          <span>
            High slippage ({value} %). You may receive significantly less than expected.
            Consider lowering your tolerance.
          </span>
        </div>
      )}
    </div>
  );
}
