# Issue 1 — Document env vars in `backend/services/streamingIndexer.js`

## What was implemented

`backend/services/streamingIndexer.js` did not exist in this codebase, so it was added as a new
service: a real-time complement to the polling-based `eventIndexer.js` that subscribes to Horizon's
Server-Sent Events stream for payment operations on a configured account and records them via
Prisma, with bounded reconnect retries.

Seven env vars are read and documented in `backend/.env.example` under a new "Streaming Indexer"
section:

- `STREAMING_INDEXER_ENABLED` — feature flag, off by default
- `STREAMING_HORIZON_URL` — SSE source (falls back to `STELLAR_HORIZON_URL`)
- `STREAMING_INDEXER_ACCOUNT` — account whose `/payments` stream is watched
- `STREAMING_INDEXER_CURSOR` — Horizon cursor to resume from
- `STREAMING_RECONNECT_DELAY_MS` / `STREAMING_MAX_RECONNECT_ATTEMPTS` — reconnect behavior
- `STREAMING_BATCH_SIZE` — SSE page size

The README setup section now references how to enable it.

## Why

The issue assumed the file already existed with undocumented env reads. Since it didn't, the fix
adds the service itself, modeled on the existing `eventIndexer.js` (Prisma writes, module logger,
`STELLAR_HORIZON_URL` fallback) so every env var the new file reads has a matching, commented
`.env.example` entry from day one — the disabled-by-default flag keeps it inert until a
contributor explicitly opts in.

## Files touched

- `backend/services/streamingIndexer.js` (new)
- `backend/.env.example`
- `README.md`
