# rateLimiter.js — shared key-generator helper

## What changed

`backend/api/middleware/rateLimiter.js` defined the same request-key
formatting logic twice — once inline in `createSlidingWindowRateLimiter`'s
`defaultKeyGen`, and again inline in `createPerUserRateLimiter`'s
`keyGenerator`. Both resolved a rate-limit key in the same three steps
(authenticated user id → `x-user-id` header → client IP), just prefixed
differently. Any future change to that precedence (e.g. adding a new auth
scheme) would have needed to be made in both places, risking drift.

## Implementation

- Added `buildDefaultKeyGenerator(prefix)`, a small factory that returns a
  `(req) => string` key generator using the shared precedence rules.
- `createSlidingWindowRateLimiter` now does
  `const getKey = keyGenerator || buildDefaultKeyGenerator(prefix);`
  instead of redefining `defaultKeyGen` inline.
- `createPerUserRateLimiter`'s dynamic (tier-aware) branch now calls
  `buildDefaultKeyGenerator(prefix)` directly instead of redefining the
  same arrow function.

## Notes

- Pure extraction — the returned key strings are byte-for-byte identical to
  before for every input, so existing tests
  (`backend/tests/rateLimiter.test.js`) require no changes.
- No behavior change; this is a duplication/drift-risk fix only.
