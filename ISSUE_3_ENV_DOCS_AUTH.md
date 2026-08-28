# Issue: `.env.example` coverage for `backend/api/middleware/auth.js`

## Summary

Audited every value `backend/api/middleware/auth.js` depends on, directly or
transitively:

- `authMiddleware` itself reads no `process.env.*` directly — it imports
  `JWT_SECRET` and `JWT_ALGORITHM` from `backend/config/secrets.js`, and
  calls `sessionService.isSessionValid()`.
- `JWT_SECRET` — read from the environment by `config/secrets.js`. **Already
  present** in `backend/.env.example` (line ~56) with a comment.
- `JWT_ALGORITHM` — **not** an environment variable. It's a hardcoded
  constant (`'HS256'`) defined directly in `config/secrets.js`. There is
  nothing to configure, so no `.env.example` entry is needed for it.
- `backend/services/sessionService.js` (used for `jti` session-revocation
  checks) — reads no environment variables at all; it only talks to Prisma.

## What changed

- `backend/.env.example`: added an explanatory comment block directly above
  `JWT_SECRET` that names `auth.js` as the consumer and explicitly notes
  that `JWT_ALGORITHM` is fixed in code, not env-configurable — so a new
  contributor searching `.env.example` for `JWT_ALGORITHM` isn't left
  wondering if an entry is missing.
- `README.md`: added a short note under **Configuration** cross-referencing
  `auth.js`'s env dependency to `backend/.env.example`.

## Why no new variables were added

The issue describes `auth.js` reading "several `process.env.*` values with
no corresponding `.env.example` entry," but a direct audit of the file and
its imports shows only one real environment dependency (`JWT_SECRET`), which
was already documented. The fix here is clarifying documentation so the
one env var that *does* exist, and the one constant that deliberately
doesn't, are both unambiguous for new contributors.

## Acceptance criteria mapping

- **Every env var read in `auth.js` has a matching `.env.example` entry with
  a comment** — `JWT_SECRET` was already present; comment expanded to name
  `auth.js` explicitly and clarify `JWT_ALGORITHM`'s non-env status.
- **README setup section references the new entries if needed** — added a
  cross-reference under `## Getting Started > ### Configuration`.
