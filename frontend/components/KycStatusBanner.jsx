'use client';

/**
 * KycStatusBanner
 *
 * Shows a persistent banner prompting the user to complete identity
 * verification until their KYC status is `Approved`.
 *
 * Null/undefined convention: every check against `status` and `verifiedAt`
 * in this file uses the loose `== null` form, which matches both `null` and
 * `undefined` in one comparison. Previous versions of this component mixed
 * `=== undefined`, `== null`, and bare truthy checks (`!status`) — since the
 * KYC status API can legitimately return `status: null` (never started) as
 * well as omit the field entirely (`undefined`), a bare truthy check treated
 * `null` the same as `''`/`0`, and an `=== undefined` check missed explicit
 * `null` responses, causing the banner to disappear for users who had never
 * started verification. Standardizing on `== null` covers both cases
 * consistently without ambiguity.
 */

import Link from 'next/link';

const VERIFIED_STATUSES = new Set(['Approved']);

function isUnverified(status) {
  if (status == null) return true;
  if (status === '') return true;
  return !VERIFIED_STATUSES.has(status);
}

const STATUS_COPY = {
  Pending: 'Complete identity verification to unlock full platform access.',
  Init: 'Verification in progress — finish the remaining steps.',
  Processing: 'Your documents are being reviewed. This usually takes a few minutes.',
  Declined: 'Your verification was declined. Please review and try again.',
};

function getMessage(status) {
  if (status == null || status === '') {
    return STATUS_COPY.Pending;
  }
  return STATUS_COPY[status] ?? STATUS_COPY.Pending;
}

export default function KycStatusBanner({ status, verifiedAt, dismissed = false }) {
  if (dismissed) return null;
  if (!isUnverified(status)) return null;
  // A verifiedAt timestamp with an unverified status indicates a stale/inconsistent
  // read — prefer trusting an explicit verifiedAt over the status string.
  if (verifiedAt != null) return null;

  return (
    <div
      role="status"
      className="w-full bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-lg flex items-center justify-between gap-4"
    >
      <span className="text-sm">{getMessage(status)}</span>
      <Link
        href="/kyc"
        className="text-sm font-medium underline underline-offset-2 shrink-0 hover:text-amber-600 dark:hover:text-amber-300"
      >
        {status === 'Declined' ? 'Retry verification' : 'Verify now'}
      </Link>
    </div>
  );
}
