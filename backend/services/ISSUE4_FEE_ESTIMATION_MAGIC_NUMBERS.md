# Issue 4 — Extract magic numbers in feeEstimationService.js

## What was implemented

`backend/services/feeEstimationService.js` does not exist in this
codebase. The real fee-estimation logic lives in
`backend/services/relayerService.js` (`estimateFee()`,
`validateMetaTransaction()`, `buildMetaTransaction()`), which had two
undocumented magic numbers alongside the one already-named constant
(`RELAYER_FEE_BUFFER`):

- `128` — expected hex-encoded length of an Ed25519 signature, used in
  `validateMetaTransaction()` to reject malformed signatures.
- `30` — transaction validity window in seconds, passed to
  `setTimeout()` in `buildMetaTransaction()`.

Both were extracted into named, commented constants
(`ED25519_SIGNATURE_HEX_LENGTH`, `TRANSACTION_TIMEOUT_SECONDS`) in
`relayerService.js`. This is a comments/naming-only change — no
conditional logic, thresholds, or return values were altered, so behavior
is unchanged.

## Recommendation

If `feeEstimationService.js` is a planned/renamed file with additional
magic numbers of its own, please point to its actual path and those will
be extracted the same way.
