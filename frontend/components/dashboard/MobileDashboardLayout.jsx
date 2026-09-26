'use client';

/**
 * MobileDashboardLayout — Mobile-first responsive dashboard shell
 *
 * A layout wrapper that adapts from a single-column stack on 375 px
 * phones to a two- or three-column grid on larger viewports, using
 * Tailwind's responsive breakpoints and the project's existing design
 * tokens (card, brand-*, dark: variants).
 *
 * Usage:
 *   <MobileDashboardLayout
 *     header={<StatsRow />}
 *     sidebar={<QuickActions />}
 *   >
 *     {children}
 *   </MobileDashboardLayout>
 *
 * Issue #24
 */

import { useState } from 'react';

// ─── Hamburger / close icons ────────────────────────────────────────
function MenuIcon({ className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      className={`h-6 w-6 ${className}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function XIcon({ className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      className={`h-6 w-6 ${className}`}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

// ─── Mobile drawer sidebar ──────────────────────────────────────────
function MobileSidebar({ open, onClose, children }) {
  if (!open) return null;
  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard sidebar"
        className="fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto
                   bg-white dark:bg-gray-900
                   border-r border-gray-200 dark:border-gray-700
                   shadow-xl p-4 lg:hidden
                   animate-fade-in"
      >
        <div className="flex items-center justify-between mb-6">
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
            Navigation
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <XIcon />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

// ─── Main export ────────────────────────────────────────────────────
/**
 * @param {{
 *   header?: React.ReactNode,
 *   sidebar?: React.ReactNode,
 *   children: React.ReactNode,
 *   className?: string,
 * }} props
 */
export default function MobileDashboardLayout({ header, sidebar, children, className = '' }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-950 ${className}`}>
      {/* ── Top bar (mobile) ────────────────────────── */}
      {sidebar && (
        <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3
                        bg-white dark:bg-gray-900
                        border-b border-gray-200 dark:border-gray-700
                        shadow-sm lg:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            aria-expanded={sidebarOpen}
            className="rounded-lg p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200
                       hover:bg-gray-100 dark:hover:bg-gray-800
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <MenuIcon />
          </button>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Dashboard</span>
        </div>
      )}

      {/* ── Mobile drawer ───────────────────────────── */}
      {sidebar && (
        <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)}>
          {sidebar}
        </MobileSidebar>
      )}

      {/* ── Page body ───────────────────────────────── */}
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header strip (stat widgets, etc.) */}
        {header && <div className="mb-6">{header}</div>}

        <div className={sidebar ? 'lg:grid lg:grid-cols-[260px_1fr] lg:gap-8' : ''}>
          {/* ── Desktop sidebar ─────────────────────── */}
          {sidebar && (
            <aside
              aria-label="Dashboard sidebar"
              className="hidden lg:block"
            >
              <div className="sticky top-6 space-y-4 rounded-xl
                              border border-gray-200 dark:border-gray-700
                              bg-white dark:bg-gray-900 p-4 shadow-sm">
                {sidebar}
              </div>
            </aside>
          )}

          {/* ── Main content ────────────────────────── */}
          <main id="main-content" className="min-w-0 space-y-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

// ─── Convenience grid helpers ───────────────────────────────────────

/** Two-column responsive card grid */
export function DashboardGrid({ children, className = '' }) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 ${className}`}
    >
      {children}
    </div>
  );
}

/** Four-column responsive stat strip */
export function DashboardStatRow({ children, className = '' }) {
  return (
    <div
      className={`grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-4 ${className}`}
    >
      {children}
    </div>
  );
}
