'use client';

import React from 'react';
import useNetworkStatus from '../../hooks/useNetworkStatus';

export default function OfflineBanner({ isOnline: isOnlineProp }) {
  const hookOnline = useNetworkStatus();
  const isOnline = typeof isOnlineProp === 'boolean' ? isOnlineProp : hookOnline;

  if (isOnline) return null; // Hide when online

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-red-600 px-4 py-2.5 text-center text-sm font-medium text-white shadow-md transition-all duration-200"
    >
      <span aria-hidden="true">⚠️</span>
      <span>You are currently offline. Some features may not work.</span>
    </div>
  );
}
