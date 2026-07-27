'use client';

/**
 * SkeletonLoader — Unified skeleton loading states for data-heavy pages
 *
 * Provides accessible, theme-aware skeleton placeholders matching the
 * Trustchain design system (Tailwind + dark mode via `dark:` classes).
 *
 * Issue #22
 */

import { Skeleton } from './Skeleton';

// ------------------------------------------------------------------
// Generic row / block primitives
// ------------------------------------------------------------------

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-label="Loading text content">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4 ${className}`}
      role="status"
      aria-label="Loading card"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <SkeletonText lines={2} />
      <div className="flex items-center justify-between pt-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonStatCard({ className = '' }) {
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-2 ${className}`}
      role="status"
      aria-label="Loading statistic"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-16" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`} role="status" aria-label="Loading table">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {Array.from({ length: cols }).map((_, c) => (
              <th key={c} className="py-3 px-4 text-left">
                <Skeleton className="h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-gray-100 dark:border-gray-800">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="py-3 px-4">
                  <Skeleton className={`h-4 ${c === 0 ? 'w-32' : 'w-20'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonDashboard({ className = '' }) {
  return (
    <div className={`space-y-6 ${className}`} role="status" aria-label="Loading dashboard">
      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      {/* Card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}

export function SkeletonProfile({ className = '' }) {
  return (
    <div className={`space-y-6 ${className}`} role="status" aria-label="Loading profile">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <SkeletonText lines={4} />
      <span className="sr-only">Loading profile…</span>
    </div>
  );
}
