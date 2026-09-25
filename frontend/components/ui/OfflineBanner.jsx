'use client';

import React from 'react';
import useNetworkStatus from '../../hooks/useNetworkStatus';

/**
 * OfflineBanner
 *
 * Displays a top-of-page banner whenever the app is offline.
 *
 * Usage:
 *   // Default: reacts to the browser's online/offline events
 *   <OfflineBanner />
 *
 *   // Driven by WebSocket status (e.g. from useEscrowUpdates)
 *   const { isOffline } = useEscrowUpdates(id);
 *   <OfflineBanner show={isOffline} message="Real-time updates paused. Reconnecting…" />
 *
 * @param {object}  [props]
 * @param {boolean} [props.show]    — when provided, overrides the network-status check
 * @param {string}  [props.message] — custom message shown in the banner
 */
export default function OfflineBanner({ show, message }) {
  const isNetworkOffline = useNetworkStatus() === false;

  // If `show` prop is explicitly supplied, it takes precedence;
  // otherwise fall back to the browser network status.
  const visible = show !== undefined ? show : isNetworkOffline;

  if (!visible) return null;

  const displayMessage =
    message ?? '⚠️ You are currently offline. Some features may not work.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-2 shadow-md"
    >
      {displayMessage}
    </div>
  );
}
