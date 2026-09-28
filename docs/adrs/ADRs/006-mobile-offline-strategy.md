# ADR 006: Mobile Offline-First Data Strategy

**Status**: accepted

## Context

The Expo mobile app must let users view escrows, milestones, and reputation data while offline or on a poor connection — freelancers and clients frequently check escrow status in the field with intermittent connectivity. The app needs a local persistence layer that can:

- Cache structured, queryable data (escrows, milestones) with per-entity TTL-based invalidation.
- Survive app restarts and remain readable without a network round trip.
- Coexist with the app's existing fast synchronous key-value store (`react-native-mmkv`, used for wallet address, preferences, and other small values — see `mobile/lib/storage.ts`) and `expo-secure-store` (used for private keys and auth tokens).

## Decision

Use `expo-sqlite` as the offline cache for structured escrow/milestone data (see `mobile/services/offlineCache.ts` and `mobile/lib/storage.ts`), queried synchronously via `openDatabaseSync`. Cached rows are stored as JSON blobs keyed by entity ID with a `cached_at` timestamp, pruned against a per-entity-type TTL (e.g. 5 minutes for escrows, 2 minutes for milestones, 30 minutes for reputation) and on app foreground.

MMKV remains the store for small, frequently-read key-value data (wallet address, tokens, UI preferences) where relational queries aren't needed; `expo-secure-store` remains the store for sensitive values (private keys, auth tokens) that require OS-level encryption at rest. SQLite is reserved for the offline cache's relational/collection data — lists of escrows and their milestones — that benefit from querying, filtering, and TTL-based expiry.

## Consequences

- **Good**: Relational queries (e.g. "milestones for escrow X") without deserializing an entire blob; per-row TTL expiry; synchronous API avoids extra render-blocking async state in list screens.
- **Good**: Corrupted rows are self-healing — `offlineCache.ts` detects JSON parse failures and deletes the offending row rather than crashing the read path.
- **Neutral**: Introduces a second persistence mechanism alongside MMKV, so contributors need to know which store to use for new data (relational/collection data → SQLite; small key-value data → MMKV; secrets → SecureStore).
- **Bad**: SQLite's synchronous API can block the JS thread on large result sets; mitigated today by small per-entity TTLs that keep cached collections small.
- **Bad**: Schema migrations require explicit version-bump handling (`CACHE_VERSION` in `offlineCache.ts`) since `expo-sqlite` has no built-in migration framework.

## Tradeoffs

| Option | Notes |
| --- | --- |
| **SQLite (`expo-sqlite`) — chosen** | Relational queries, per-row TTL, synchronous reads for list/detail screens; requires manual schema versioning. |
| MMKV (`react-native-mmkv`) | Extremely fast synchronous key-value access, already used for small values in `mobile/lib/storage.ts`; not designed for relational queries or paginated collections of JSON records. |
| AsyncStorage-only | Ships with React Native, no native module required; async-only API (adds loading states to every read), no query capability, and is materially slower than both alternatives for larger datasets — ruled out for the offline escrow list. |

## References

- `mobile/services/offlineCache.ts` — escrow cache implementation, TTL logic, schema versioning.
- `mobile/lib/storage.ts` — MMKV-backed key-value store and SecureStore wrapper.
- `mobile/package.json` — `expo-sqlite`, `react-native-mmkv`, `expo-secure-store` dependencies.

**Reviewers**: @mobile-team

**Signed**: architecture-team 2026-09-28
