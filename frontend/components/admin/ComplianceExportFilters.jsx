'use client';

/**
 * ComplianceExportFilters
 *
 * A controlled form that collects filters for compliance exports:
 *   - Date range (from / to)
 *   - Report type  (transactions | users | activity)
 *   - Status       (varies by report type)
 *   - Export format (json | csv | pdf)
 *   - Tenant        (optional free-text)
 *
 * On every valid filter change it calls `onEstimate(filters)` so the parent
 * can fetch an estimated result size from the backend.  Validation errors are
 * shown inline and `onChange` / `onSubmit` are only called when the filter
 * set is valid.
 *
 * @param {object}   props
 * @param {object}   [props.initialFilters]     Seed values for the form
 * @param {function} [props.onChange]           Called with valid filters on every change
 * @param {function} [props.onSubmit]           Called with filters when the Export button is clicked
 * @param {function} [props.onEstimate]         Called with valid filters to trigger size estimation
 * @param {object}   [props.estimatedSize]      Result from the parent's estimation call
 *                                              { totalEstimate, counts, loading, error }
 * @param {boolean}  [props.disabled]           Disable all inputs (e.g. while export is running)
 */

import { useState, useEffect, useCallback } from 'react';

// ── Constants mirroring the backend ──────────────────────────────────────────

const REPORT_TYPES = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'users', label: 'Users' },
  { value: 'activity', label: 'Activity' },
];

const EXPORT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'pdf', label: 'PDF' },
];

const STATUS_OPTIONS = {
  transactions: [
    { value: '', label: 'Any' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Failed', label: 'Failed' },
    { value: 'Refunded', label: 'Refunded' },
    { value: 'Active', label: 'Active (escrow)' },
    { value: 'Disputed', label: 'Disputed (escrow)' },
    { value: 'Cancelled', label: 'Cancelled (escrow)' },
    { value: 'Expired', label: 'Expired (escrow)' },
  ],
  users: [
    { value: '', label: 'Any' },
    { value: 'Pending', label: 'KYC Pending' },
    { value: 'Approved', label: 'KYC Approved' },
    { value: 'Declined', label: 'KYC Declined' },
    { value: 'Expired', label: 'KYC Expired' },
  ],
  activity: [{ value: '', label: 'Any' }],
};

const EMPTY_FILTERS = {
  reportType: 'transactions',
  format: 'csv',
  from: '',
  to: '',
  status: '',
  tenant: '',
};

// ── Validation ────────────────────────────────────────────────────────────────

function validateFilters(filters) {
  const errors = {};

  if (!filters.reportType) {
    errors.reportType = 'A report type is required.';
  }

  if (!filters.format) {
    errors.format = 'An export format is required.';
  }

  if (filters.from && Number.isNaN(Date.parse(filters.from))) {
    errors.from = 'Invalid start date.';
  }

  if (filters.to && Number.isNaN(Date.parse(filters.to))) {
    errors.to = 'Invalid end date.';
  }

  if (filters.from && filters.to && !errors.from && !errors.to) {
    if (new Date(filters.from) > new Date(filters.to)) {
      errors.to = '"From" date must not be later than "To" date.';
    }
  }

  if (filters.tenant !== undefined && filters.tenant !== '' && typeof filters.tenant !== 'string') {
    errors.tenant = 'Tenant must be a text value.';
  }

  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceExportFilters({
  initialFilters = {},
  onChange,
  onSubmit,
  onEstimate,
  estimatedSize,
  disabled = false,
}) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Derive status options based on current report type
  const statusOptions = STATUS_OPTIONS[filters.reportType] ?? STATUS_OPTIONS.activity;

  // Validate and propagate whenever filters change
  const applyChange = useCallback(
    (next) => {
      const errs = validateFilters(next);
      setErrors(errs);

      const isValid = Object.keys(errs).length === 0;
      if (isValid) {
        onChange?.(next);
        onEstimate?.(next);
      }
    },
    [onChange, onEstimate],
  );

  function handleField(field, value) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const next = { ...filters, [field]: value };

    // Reset status when report type changes (statuses are type-specific)
    if (field === 'reportType') {
      next.status = '';
    }

    setFilters(next);
    applyChange(next);
  }

  // Run validation once on mount for pre-seeded values
  useEffect(() => {
    applyChange(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    // Mark all fields as touched so errors show up on submit
    setTouched({ reportType: true, format: true, from: true, to: true, tenant: true });
    const errs = validateFilters(filters);
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      onSubmit?.(filters);
    }
  }

  const showError = (field) => touched[field] && errors[field];

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Compliance export filters"
      className="space-y-4"
      noValidate
    >
      {/* Report type */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Report type <span aria-hidden="true" className="text-red-500">*</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Report type">
          {REPORT_TYPES.map(({ value, label }) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors
                ${filters.reportType === value
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500'
                }
                ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="reportType"
                value={value}
                checked={filters.reportType === value}
                onChange={() => handleField('reportType', value)}
                disabled={disabled}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {showError('reportType') && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {errors.reportType}
          </p>
        )}
      </fieldset>

      {/* Date range */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="compliance-from"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            From date
          </label>
          <input
            type="date"
            id="compliance-from"
            name="from"
            value={filters.from}
            onChange={(e) => handleField('from', e.target.value)}
            disabled={disabled}
            aria-describedby={showError('from') ? 'compliance-from-error' : undefined}
            aria-invalid={!!showError('from')}
            className={`w-full rounded-lg border px-3 py-2 text-sm
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
              focus:outline-none focus:border-indigo-500 transition-colors
              ${showError('from') ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'}
              ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          {showError('from') && (
            <p id="compliance-from-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {errors.from}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="compliance-to"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            To date
          </label>
          <input
            type="date"
            id="compliance-to"
            name="to"
            value={filters.to}
            onChange={(e) => handleField('to', e.target.value)}
            disabled={disabled}
            aria-describedby={showError('to') ? 'compliance-to-error' : undefined}
            aria-invalid={!!showError('to')}
            className={`w-full rounded-lg border px-3 py-2 text-sm
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
              focus:outline-none focus:border-indigo-500 transition-colors
              ${showError('to') ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'}
              ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          {showError('to') && (
            <p id="compliance-to-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
              {errors.to}
            </p>
          )}
        </div>
      </div>

      {/* Status */}
      <div>
        <label
          htmlFor="compliance-status"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Status filter
        </label>
        <select
          id="compliance-status"
          name="status"
          value={filters.status}
          onChange={(e) => handleField('status', e.target.value)}
          disabled={disabled}
          className={`w-full rounded-lg border px-3 py-2 text-sm
            bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
            focus:outline-none focus:border-indigo-500 transition-colors
            border-gray-300 dark:border-gray-700
            ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {statusOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Tenant */}
      <div>
        <label
          htmlFor="compliance-tenant"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Tenant <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          id="compliance-tenant"
          name="tenant"
          value={filters.tenant}
          onChange={(e) => handleField('tenant', e.target.value)}
          placeholder="e.g. acme-corp"
          disabled={disabled}
          aria-describedby={showError('tenant') ? 'compliance-tenant-error' : undefined}
          aria-invalid={!!showError('tenant')}
          className={`w-full rounded-lg border px-3 py-2 text-sm
            bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
            placeholder-gray-400 dark:placeholder-gray-500
            focus:outline-none focus:border-indigo-500 transition-colors
            ${showError('tenant') ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'}
            ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
        {showError('tenant') && (
          <p id="compliance-tenant-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {errors.tenant}
          </p>
        )}
      </div>

      {/* Export format */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Export format <span aria-hidden="true" className="text-red-500">*</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Export format">
          {EXPORT_FORMATS.map(({ value, label }) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors
                ${filters.format === value
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                  : 'border-gray-300 text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500'
                }
                ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="format"
                value={value}
                checked={filters.format === value}
                onChange={() => handleField('format', value)}
                disabled={disabled}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {showError('format') && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {errors.format}
          </p>
        )}
      </fieldset>

      {/* Estimated result size */}
      {estimatedSize && (
        <div
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm
            ${estimatedSize.error
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
              : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
        >
          {estimatedSize.loading && (
            <span className="text-gray-500 dark:text-gray-400">Estimating result size…</span>
          )}
          {estimatedSize.error && !estimatedSize.loading && (
            <span>Could not estimate size: {estimatedSize.error}</span>
          )}
          {!estimatedSize.loading && !estimatedSize.error && estimatedSize.totalEstimate !== undefined && (
            <div className="space-y-1">
              <p>
                <span className="font-semibold text-gray-900 dark:text-gray-50">
                  ~{formatCount(estimatedSize.totalEstimate)}
                </span>{' '}
                estimated rows
              </p>
              {estimatedSize.counts && (
                <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  {Object.entries(estimatedSize.counts).map(([key, count]) => (
                    <li key={key}>
                      {key}: {formatCount(count)}
                    </li>
                  ))}
                </ul>
              )}
              {estimatedSize.totalEstimate > 5000 && (
                <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">
                  ⚠ Large result set — consider narrowing the date range.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {onSubmit && (
        <button
          type="submit"
          disabled={disabled || Object.keys(errors).length > 0}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white
            transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Export
        </button>
      )}
    </form>
  );
}
