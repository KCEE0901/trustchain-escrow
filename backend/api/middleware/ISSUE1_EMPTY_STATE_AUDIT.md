# Issue 1 — Empty state for adminAuth.js

## What was implemented

`backend/api/middleware/adminAuth.js` exists, but it is an Express
authentication middleware, not a list/collection view. It has two code
paths — validate a Bearer JWT, or validate an `x-admin-api-key` header —
and either calls `next()` or returns a 401/403 JSON error. There is no
data source returning a list of results, and nothing rendered to a user
that could show an "empty state" (no items found, no matches, etc.).

Audit performed:

- Read the full file (158 lines): brute-force guard, JWT verification,
  raw-API-key comparison. No `.map()`, no collection iteration, no
  templated/rendered output of any kind.
- Searched `backend/api` and `frontend/` for admin list views (e.g. an
  admin dashboard table of users, escrows, or disputes) that might be the
  actual intended target for an empty-state fix — the closest candidates
  render via their own components, none of which import `adminAuth.js`
  for rendering (only for route protection).

## Recommendation

If a specific admin list/table component was intended (e.g. an empty
admin dashboard table), please point to it directly and an empty state
matching the existing styling can be added there. No change was made to
`adminAuth.js` since it has no collection to render and altering its
control flow without a matching real scenario risks changing auth
behavior with no way to verify it under this task's no-test/no-build
constraint.
