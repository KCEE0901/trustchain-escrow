# Issue 3 — Extract shared validation/formatting helper in streamingIndexer.js

## What was implemented

`backend/services/streamingIndexer.js` does not exist in this codebase.
The closest real services are `backend/services/eventIndexer.js` and
`backend/services/escrowIndexer.js`.

Audit performed:

- Searched both files for duplicated validation/formatting logic (the
  pattern described in this issue). `escrowIndexer.js` was already
  refactored on `develop` (commit `853deab`) to standardize its
  null/undefined handling into a consistent pattern, which is the same
  category of drift-risk cleanup this issue describes.
- No further duplicated validation/formatting block was found repeated
  across multiple functions in either file that would be safe to extract
  without deeper familiarity with call sites and existing test coverage —
  extracting the wrong shared helper under a no-test/no-build constraint
  risks silently changing indexer behavior (e.g. ledger-cursor handling)
  that has no fast way to be verified here.

## Recommendation

If `streamingIndexer.js` is a planned/renamed file, or if a specific pair
of functions in `eventIndexer.js`/`escrowIndexer.js` was the intended
target, please point to the exact duplication and it can be extracted into
a shared helper with a matching unit test, following the pattern already
established in `backend/tests/escrowIndexerService.test.js`.
