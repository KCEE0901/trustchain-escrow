# KYC Status Lifecycle

KYC status combines provider callbacks, manual review, and user-facing account
access. This document defines the expected states and transitions.

## Statuses

| Status | Meaning | User Copy |
| --- | --- | --- |
| `not_started` | No KYC session has been created. | Start verification to unlock protected actions. |
| `pending_submission` | User started but has not completed provider flow. | Continue verification. |
| `pending_review` | Provider or internal reviewer is evaluating the submission. | Verification is under review. |
| `approved` | User passed KYC and can use gated features. | Verification approved. |
| `rejected` | Submission failed policy or provider checks. | Verification was not approved. |
| `expired` | Approval is no longer valid. | Verification expired; refresh required. |
| `manual_review` | Internal reviewer must decide the outcome. | Verification needs manual review. |
| `suspended` | Compliance has temporarily blocked the account. | Account access is restricted. |

## Provider Callback Transitions

- `not_started` to `pending_submission` when a session is created.
- `pending_submission` to `pending_review` when the user completes provider
  collection.
- `pending_review` to `approved`, `rejected`, or `manual_review` from provider
  result callbacks.
- `approved` to `expired` when the configured refresh window elapses.

## Manual Overrides

Compliance admins may move a user to `approved`, `rejected`, `manual_review`,
`expired`, or `suspended`. Every manual override must include reviewer id,
reason, timestamp, previous status, and correlation id.

## Client Behavior

- Frontend and mobile should display the status and last sync time.
- Cached `approved` status should not unlock actions after the freshness window.
- Rejected users should see the next allowed remediation step when available.
- Suspended users should receive support-oriented copy instead of retry prompts.
