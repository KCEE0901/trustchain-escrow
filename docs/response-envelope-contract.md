# Response Envelope API Contract

All JSON API clients should expect a consistent response envelope unless a route
is explicitly documented as an exception.

## Envelope Fields

| Field | Type | Description |
| --- | --- | --- |
| `success` | boolean | `true` for successful responses and `false` for errors. |
| `data` | object, array, or null | Endpoint payload on success, otherwise `null`. |
| `error` | object or null | Normalized error object on failure, otherwise `null`. |
| `meta` | object | Request metadata such as correlation id and pagination. |

## Error Object

| Field | Type | Description |
| --- | --- | --- |
| `code` | string | Stable machine-readable error code. |
| `message` | string | Human-readable summary safe for logs and mapped UI copy. |
| `details` | object or null | Optional field-level or diagnostic details. |

## Pagination Metadata

Collection endpoints should place pagination inside `meta.pagination`.

| Field | Type | Description |
| --- | --- | --- |
| `limit` | number | Maximum number of records requested. |
| `nextCursor` | string or null | Cursor for the next page. |
| `previousCursor` | string or null | Cursor for the previous page when supported. |
| `total` | number or null | Total count only when the query can return it cheaply. |
| `hasMore` | boolean | Whether another page is available. |

## Correlation ID

When present, `meta.correlationId` must match the `X-Correlation-Id` response
header. Frontend and mobile clients should include it in support-visible error
states.

## Exceptions

The envelope can be bypassed for health probes, file downloads, websocket
frames, webhook acknowledgements, and legacy routes documented with an owner and
migration plan.
