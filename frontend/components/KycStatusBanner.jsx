'use client';

// Delay before auto-clearing any transient status emphasis.
export const KYC_STATUS_RESET_DELAY_MS = 3000;
// Threshold used to flip to a compact banner treatment on narrow screens.
export const KYC_STATUS_COMPACT_BREAKPOINT_PX = 640;

export default function KycStatusBanner({ status = 'Pending' }) {
  return <div aria-label={`KYC status: ${status}`}>{status}</div>;
}
