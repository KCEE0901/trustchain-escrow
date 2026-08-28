/**
 * Audit Controller
 *
 * HTTP controller layer for audit-log endpoints.  Wraps auditService calls in
 * structured JSON responses that include pagination `links` (RFC 5988) so that
 * API clients — including screen-reader / keyboard-only tools — can navigate
 * result sets programmatically without relying on mouse interaction.
 *
 * Response shape:
 * ```json
 * {
 *   "success": true,
 *   "data": [...],
 *   "meta": { "total": 120, "page": 2, "limit": 20, "totalPages": 6 },
 *   "links": { "self": "...", "first": "...", "prev": "...", "next": "...", "last": "..." }
 * }
 * ```
 *
 * The `Link` HTTP header mirrors the `links` object in RFC 5988 format so that
 * HTTP-level link parsers (curl, screen-reader browser extensions, pagination
 * libraries) can navigate without parsing the response body.
 *
 * @module api/controllers/auditController
 */

import auditService from '../../services/auditService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build an absolute URL for the current request with a page override.
 *
 * @param {import('express').Request} req
 * @param {number} page
 * @returns {string}
 */
function buildPageUrl(req, page) {
  const query = new URLSearchParams({ ...req.query, page: String(page) });
  const base = `${req.protocol}://${req.get('host')}${req.path}`;
  return `${base}?${query.toString()}`;
}

/**
 * Build RFC 5988 `Link` header value from a links object.
 *
 * @param {{ self?: string, first?: string, prev?: string, next?: string, last?: string }} links
 * @returns {string}
 */
function buildLinkHeader(links) {
  return Object.entries(links)
    .filter(([, url]) => url)
    .map(([rel, url]) => `<${url}>; rel="${rel}"`)
    .join(', ');
}

/**
 * Derive pagination metadata and navigation links from a service result.
 *
 * Works with both `{ total, page, limit }` and `{ total, offset, limit }`
 * shapes returned by auditService.search().
 *
 * @param {import('express').Request} req
 * @param {{ total: number, page?: number, limit?: number, offset?: number }} result
 * @returns {{ meta: object, links: object }}
 */
function buildPaginationContext(req, result) {
  const limit = Number(result.limit ?? req.query.limit ?? 20);
  const total = Number(result.total ?? 0);
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  // Support both page-based and offset-based results from the service.
  const currentPage = result.page != null
    ? Number(result.page)
    : Math.floor((result.offset ?? 0) / limit) + 1;

  const meta = {
    total,
    page: currentPage,
    limit,
    totalPages,
    // ARIA-compatible label so assistive-tech clients can announce position.
    ariaLabel: `Page ${currentPage} of ${totalPages}, ${total} total results`,
  };

  const links = {
    self: buildPageUrl(req, currentPage),
    first: buildPageUrl(req, 1),
    ...(currentPage > 1 && { prev: buildPageUrl(req, currentPage - 1) }),
    ...(currentPage < totalPages && { next: buildPageUrl(req, currentPage + 1) }),
    last: buildPageUrl(req, Math.max(totalPages, 1)),
  };

  return { meta, links };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * Search audit logs.
 *
 * Accepts query parameters forwarded to auditService.search() and returns a
 * structured JSON response with pagination metadata and RFC 5988 Link headers.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 *
 * @example
 * // GET /api/audit?category=escrow&page=2&limit=20
 * // Response headers:
 * //   Link: <...?page=2>; rel="self", <...?page=1>; rel="first",
 * //         <...?page=1>; rel="prev", <...?page=3>; rel="next",
 * //         <...?page=6>; rel="last"
 */
export async function searchAuditLogs(req, res) {
  try {
    const result = await auditService.search(req.query);

    const { meta, links } = buildPaginationContext(req, result);

    // RFC 5988 Link header — enables keyboard/screen-reader clients to navigate
    // without parsing the response body.
    res.setHeader('Link', buildLinkHeader(links));
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json({
      success: true,
      data: result.data ?? result.items ?? result,
      meta,
      links,
    });
  } catch (err) {
    const status = err.status ?? err.statusCode ?? 500;
    const isClientError = status >= 400 && status < 500;

    return res.status(status).json({
      success: false,
      error: {
        message: isClientError
          ? err.message
          : 'An unexpected error occurred while searching audit logs.',
        ...(isClientError && { details: err.details }),
        code: err.code ?? (isClientError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'),
      },
      meta: { ariaLabel: 'Search failed' },
      links: {},
    });
  }
}

/**
 * Export audit logs as a CSV file.
 *
 * Sets `Content-Disposition` and `Content-Type` headers for a file download.
 * Returns a 422 with a structured JSON body (not a raw string) if the service
 * reports a validation error, so API clients can parse the failure programmatically.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 *
 * @example
 * // GET /api/audit/export?category=escrow&from=2024-01-01
 * // Response headers:
 * //   Content-Type: text/csv; charset=utf-8
 * //   Content-Disposition: attachment; filename="audit-export-1714000000000.csv"
 */
export async function exportAuditLogs(req, res) {
  try {
    const csv = await auditService.exportCsv(req.query);
    const filename = `audit-export-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Allow clients to determine row count from the header without parsing CSV.
    if (typeof csv === 'string') {
      // Subtract 1 for header row; guard against empty export.
      const rowCount = Math.max(csv.split('\n').filter(Boolean).length - 1, 0);
      res.setHeader('X-Row-Count', String(rowCount));
    }

    return res.status(200).send(csv);
  } catch (err) {
    const status = err.status ?? err.statusCode ?? 500;
    const isClientError = status >= 400 && status < 500;

    // Always return JSON on error so clients can parse the failure, even though
    // the success path sends CSV.
    res.setHeader('Content-Type', 'application/json');

    return res.status(isClientError ? 422 : 500).json({
      success: false,
      error: {
        message: isClientError
          ? err.message
          : 'An unexpected error occurred while exporting audit logs.',
        code: err.code ?? (isClientError ? 'EXPORT_INVALID_REQUEST' : 'EXPORT_ERROR'),
      },
    });
  }
}
