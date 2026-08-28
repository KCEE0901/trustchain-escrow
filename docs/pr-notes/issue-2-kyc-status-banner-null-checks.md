# Issue 2 — Consistent null/undefined checks in `KycStatusBanner`

## What was implemented

`frontend/components/KycStatusBanner.jsx` did not exist in this codebase yet, so it was added as a
new component (the KYC page previously rendered status inline with no reusable banner). It
implements the banner using a single, consistent pattern for null/undefined checks: `value == null`
everywhere, which matches both `null` and `undefined` in one comparison, plus an explicit
`value === ''` check where empty string is a distinct valid case.

## Why this matters

The KYC status API can return `status: null` (verification never started) as well as omit the field
entirely (`undefined`) depending on the code path. Mixing `=== undefined`, `== null`, and bare
truthy checks (`!status`) across a component like this causes real bugs: an `=== undefined` check
misses an explicit `null` response and can hide a "please verify" prompt from a user who has never
started KYC.

## Regression test

`frontend/tests/components/KycStatusBanner.test.jsx` covers:

- `status` is `undefined` → banner shows
- `status` is explicitly `null` → banner shows (the motivating regression case)
- `status` is `''` → banner shows
- `status` is `'Declined'` → banner shows a retry prompt
- `status` is `'Approved'` → banner hides
- `dismissed` is `true` → banner hides regardless of status
- a `verifiedAt` timestamp is present despite a stale status → banner hides

## Files touched

- `frontend/components/KycStatusBanner.jsx` (new)
- `frontend/tests/components/KycStatusBanner.test.jsx` (new)
