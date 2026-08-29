# auditService.js — JSDoc coverage

## What changed

`backend/services/auditService.js` already had `@param` blocks on its main
exported functions (`log`, `search`, `exportCsv`, `purgeOldRecords`), but the
coverage was incomplete:

- The two exported enum constants, `AuditCategory` and `AuditAction`, had no
  documentation describing their purpose or shape.
- `@returns` annotations were missing or untyped on `log`, `search`,
  `exportCsv`, and `purgeOldRecords` (some had a bare description with no
  `@returns` tag, others described the return shape informally).
- The internal `buildWhereClause` helper (shared by `search` and
  `exportCsv`) had no `@param`/`@returns` documentation at all.
- There was no shared type describing an audit log record, so each function
  redefined the return shape ad hoc.

## Implementation

- Added an `@typedef {object} AuditLogEntry` describing the shape of a
  persisted audit record (`id`, `category`, `action`, `actor`, `resourceId`,
  `metadata`, `statusCode`, `ipAddress`, `createdAt`), referenced from
  `search`'s `@returns` tag.
- Documented `AuditCategory` and `AuditAction` with a one-line `@type`
  description each.
- Added/typed `@returns` tags on `log` (`Promise<void>`), `search`
  (`Promise<{ data: AuditLogEntry[], total, page, limit, pages }>`),
  `exportCsv` (`Promise<string>`), and `purgeOldRecords` (`Promise<number>`).
- Added a full `@param`/`@returns` JSDoc block to `buildWhereClause`.
- Documented the default export object's shape.

## Notes

- Comment-only change — no runtime behavior was modified.
- No new lint rules were introduced; existing JSDoc conventions in the file
  (four-space param descriptions, `[name]` for optional params) were
  followed for consistency.
