import { validationResult, query, param, body } from 'express-validator';

/** Maximum unsigned 64-bit integer (inclusive) for on-chain / DB escrow identifiers. */
const U64_MAX = 18446744073709551615n;

/**
 * Runs express-validator chains and, on failure, responds with HTTP 400 and a stable JSON body.
 *
 * Response shape:
 * `{ error: 'Validation failed', details: [{ field, message, location }] }`
 *
 * @param {import('express-validator').ValidationChain[]} chains
 * @returns {import('express').RequestHandler}
 */
export function validate(chains) {
  return async (req, res, next) => {
    await Promise.all(chains.map((c) => c.run(req)));
    const result = validationResult(req);
    if (result.isEmpty()) {
      return next();
    }
    const details = result.array({ onlyFirstError: false }).map((e) => ({
      field: e.path,
      message: e.msg,
      location: e.location,
    }));
    return res.status(400).json({
      error: 'Validation failed',
      details,
    });
  };
}

// ── Dispute API schemas (express-validator chains) ───────────────────────────

/**
 * GET /api/disputes — query parameters
 *
 * | Field  | Required | Type    | Rules                          |
 * |--------|----------|---------|--------------------------------|
 * | page   | no       | integer | 1 ≤ page ≤ 1_000_000           |
 * | limit  | no       | integer | 1 ≤ limit ≤ 100                |
 *
 * Omitted or empty (falsy) values fall through to controller defaults.
 */
export const disputeListQueryRules = [
  query('page')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 1_000_000 })
    .withMessage('page must be an integer between 1 and 1000000'),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
];

/**
 * GET /api/disputes/:escrowId — route parameter
 *
 * | Field     | Required | Type   | Rules                                                |
 * |-----------|----------|--------|------------------------------------------------------|
 * | escrowId  | yes      | string | Decimal digits only, 1 ≤ value ≤ 2^64−1, length ≤ 20 |
 */
export const disputeEscrowIdParamRules = [
  param('escrowId')
    .trim()
    .notEmpty()
    .withMessage('escrowId is required')
    .matches(/^[0-9]+$/)
    .withMessage('escrowId must be a non-negative decimal string')
    .isLength({ min: 1, max: 20 })
    .withMessage('escrowId must be between 1 and 20 digits')
    .custom((value) => {
      try {
        const n = BigInt(value);
        if (n < 1n || n > U64_MAX) {
          throw new Error('out of range');
        }
        return true;
      } catch {
        throw new Error('escrowId must be a valid escrow identifier');
      }
    }),
];

// ── Search API schemas ────────────────────────────────────────────────────────

const SEARCH_MAX_Q_LENGTH = 200;

/**
 * GET /api/search — query parameters
 *
 * | Field  | Required | Type    | Rules                             |
 * |--------|----------|---------|-----------------------------------|
 * | q      | no       | string  | max 200 chars, stripped of control chars |
 * | limit  | no       | integer | 1 ≤ limit ≤ 100                   |
 * | from   | no       | integer | 0 ≤ from                          |
 */
export const searchQueryRules = [
  query('q')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('q must be a string')
    .isLength({ max: SEARCH_MAX_Q_LENGTH })
    .withMessage(`q must not exceed ${SEARCH_MAX_Q_LENGTH} characters`)
    // Strip ASCII control characters (U+0000–U+001F and DEL) that could
    // pollute log output or corrupt Elasticsearch query strings.
    // eslint-disable-next-line no-control-regex
    .customSanitizer((v) => v.replace(/[\x00-\x1F\x7F]/g, '')),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
  query('from')
    .optional({ values: 'falsy' })
    .isInt({ min: 0 })
    .withMessage('from must be a non-negative integer'),
];

// ── Webhook API schemas ───────────────────────────────────────────────────────

/**
 * POST /api/webhooks/subscribe — request body
 *
 * | Field      | Required | Type     | Rules                         |
 * |------------|----------|----------|-------------------------------|
 * | url        | yes      | string   | valid HTTPS URL               |
 * | eventTypes | yes      | string[] | non-empty, max 20 items       |
 */
export const webhookSubscribeRules = [
  body('url')
    .notEmpty()
    .withMessage('url is required')
    .isURL({ protocols: ['https'], require_protocol: true })
    .withMessage('url must be a valid HTTPS URL'),
  body('eventTypes')
    .isArray({ min: 1, max: 20 })
    .withMessage('eventTypes must be a non-empty array with at most 20 entries'),
  body('eventTypes.*').isString().withMessage('each eventType must be a string'),
];

// ── Evidence upload API schemas ───────────────────────────────────────────────

/**
 * Allowed MIME types for evidence uploads — mirrors the allowlist in fileUpload.js.
 * Defined here so validation.js can enforce it without importing the multer
 * middleware (which carries heavy side-effects and is used at request time).
 */
const EVIDENCE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4'];

/** Maximum evidence file size in bytes (50 MB). */
const EVIDENCE_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/disputes/:id/evidence — request body fields
 *
 * Validates the optional text description attached to an evidence upload.
 * File metadata (MIME type, size, filename) is enforced by the multer
 * middleware chain in fileUpload.js; these rules cover the JSON body fields.
 *
 * | Field       | Required | Type   | Rules                                |
 * |-------------|----------|--------|--------------------------------------|
 * | description | no       | string | max 2000 chars, stripped of ctrl chars |
 * | role        | no       | string | client | freelancer | arbiter | admin  |
 */
export const evidenceUploadBodyRules = [
  body('description')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('description must be a string')
    .isLength({ max: 2000 })
    .withMessage('description must not exceed 2000 characters')
    // Strip ASCII control characters that could corrupt log output
    // eslint-disable-next-line no-control-regex
    .customSanitizer((v) => v.replace(/[\x00-\x1F\x7F]/g, '')),
  body('role')
    .optional({ values: 'falsy' })
    .isIn(['client', 'freelancer', 'arbiter', 'admin'])
    .withMessage('role must be one of: client, freelancer, arbiter, admin'),
];

/**
 * Validate file metadata fields when provided as JSON (non-multipart flows).
 *
 * Multipart uploads are validated by multer's fileFilter, but some API clients
 * may pass metadata in the JSON body alongside a pre-uploaded CID. These rules
 * cover that path.
 *
 * | Field      | Required | Type   | Rules                                |
 * |------------|----------|--------|--------------------------------------|
 * | mimeType   | no       | string | must be in EVIDENCE_ALLOWED_MIME_TYPES |
 * | fileSize   | no       | int    | 1 ≤ fileSize ≤ 50MB                  |
 * | filename   | no       | string | 1–255 chars, alphanumeric + safe chars |
 */
export const evidenceMetadataRules = [
  body('mimeType')
    .optional({ values: 'falsy' })
    .isIn(EVIDENCE_ALLOWED_MIME_TYPES)
    .withMessage(
      `mimeType must be one of: ${EVIDENCE_ALLOWED_MIME_TYPES.join(', ')}`,
    ),
  body('fileSize')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: EVIDENCE_MAX_FILE_SIZE_BYTES })
    .withMessage(
      `fileSize must be a positive integer not exceeding ${EVIDENCE_MAX_FILE_SIZE_BYTES} bytes`,
    ),
  body('filename')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('filename must be a string')
    .isLength({ min: 1, max: 255 })
    .withMessage('filename must be between 1 and 255 characters')
    .matches(/^[a-zA-Z0-9_\-. ]+$/)
    .withMessage(
      'filename must contain only letters, digits, spaces, underscores, dashes, or dots',
    ),
];

export { EVIDENCE_ALLOWED_MIME_TYPES, EVIDENCE_MAX_FILE_SIZE_BYTES };
