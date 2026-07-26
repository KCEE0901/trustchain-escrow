'use client';

/**
 * DarkModeToggle — System-preference-aware dark mode switcher
 *
 * Reads window.matchMedia('(prefers-color-scheme: dark)') on first load
 * via ThemeContext (contexts/ThemeContext.jsx). Persists user choice in
 * localStorage. Applies the Tailwind `dark` class to <html>.
 *
 * Issue #23
 */

import { useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const SunIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/**
 * @param {{ className?: string, iconOnly?: boolean }} props
 */
export default function DarkModeToggle({ className = '', iconOnly = false }) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — render after mount
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className={`h-9 w-9 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700 ${className}`} />
    );
  }

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`
        inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium
        transition-colors duration-200
        bg-gray-100 hover:bg-gray-200 text-gray-700
        dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
        ${className}
      `}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      {!iconOnly && <span>{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
