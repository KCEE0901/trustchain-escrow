# Admin list empty states

## What changed

`backend/api/middleware/adminAuth.js` itself only handles authentication and
has no list-rendering logic, so this change targets the admin list endpoints
it protects, which previously returned a bare empty array with no
explanation when there was no data to show:

- `GET /api/admin/users` (`adminController.listUsers`)
- `GET /api/admin/disputes` (`adminController.listDisputes`)
- `GET /api/admin/audit-logs` (`adminController.getAuditLogs`)
- `GET /api/admin/secrets/audit` (`adminRoutes.js`)

## How it works

A small `withEmptyState(result, message)` helper in `adminController.js`
appends `meta.empty` and `meta.message` to the response whenever `data` is
empty. This mirrors the empty-state convention the `/api/admin/2fa/compliance`
endpoint already used (`meta.message`), so the new endpoints match existing
styling instead of inventing a new response shape.

Each endpoint's message is context-specific and actionable, e.g.:

- Users: `No users match "<search>". Try a different address or clear the search filter.`
- Disputes: varies by the `resolved` filter (open / resolved / none raised yet).
- Audit logs: `No admin actions have been logged yet...`
- Secrets audit: `No secrets access has been recorded yet...`

## Why not `lib/pagination.js`

`buildPaginatedResponse` is shared by many controllers and is pinned by an
exact-shape test (`backend/tests/pagination.test.js`), so the empty-state
field is added by the caller after building the paginated response instead
of inside the shared helper, keeping this change scoped to the admin
endpoints and avoiding any risk to that test or other callers.
