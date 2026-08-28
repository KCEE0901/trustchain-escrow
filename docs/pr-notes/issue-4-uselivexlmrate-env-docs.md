# Issue 4 — Document env vars in `frontend/hooks/useLiveXlmRate.js`

## What was implemented

`frontend/hooks/useLiveXlmRate.js` did not exist in this codebase, so it was added as a new hook
that polls a public price API (CoinGecko, no key required) for the current XLM/USD rate, with a
localStorage-backed cache so a transient network failure doesn't blank an already-displayed rate.

Three env vars are read and documented in `frontend/.env.example` under a new "Live XLM/USD Rate"
section:

- `NEXT_PUBLIC_XLM_RATE_API_URL` — price API endpoint
- `NEXT_PUBLIC_XLM_RATE_POLL_INTERVAL_MS` — polling cadence
- `NEXT_PUBLIC_XLM_RATE_CACHE_TTL_MS` — how long a cached rate is trusted as a fallback

The README setup section now references these alongside the existing `.env.example` copy step.

## Why

The issue assumed the hook already existed with undocumented env reads. Since it didn't exist yet,
the fix was to add the hook itself following the existing pattern used by
`frontend/contexts/CurrencyContext.jsx` (env-configurable URL + polling/cache interval, with every
var mirrored in `.env.example`), rather than leaving a stale reference to a non-existent file.

## Files touched

- `frontend/hooks/useLiveXlmRate.js` (new)
- `frontend/.env.example`
- `README.md`
