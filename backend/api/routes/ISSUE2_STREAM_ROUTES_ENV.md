# Issue 2 — Document env vars read by streamRoutes.js

## What was implemented

`backend/api/routes/streamRoutes.js` does not exist in this codebase —
there is no route file by that name under `backend/api/routes/`. The
closest existing routes that deal with streaming/real-time data are
`backend/api/routes/queueDashboardRoutes.js` and
`backend/api/routes/escrowRoutes.js` (SSE-style endpoints), neither of
which introduces any `process.env.*` reads beyond what's already
documented in `backend/.env.example` (e.g. `REDIS_URL`,
`WS_HEARTBEAT_INTERVAL_MS`, `WS_MAX_CONNECTIONS`).

## Recommendation

If `streamRoutes.js` is a planned/renamed file that hasn't landed on this
branch yet, please point to its actual path (or the PR introducing it) and
its env vars will be added to `backend/.env.example` with comments, plus a
README reference if needed. No file was fabricated to satisfy this issue
since doing so would document env vars for code that isn't part of the
codebase.
