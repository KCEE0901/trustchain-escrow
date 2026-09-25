/**
 * Escrow Template Validation — Issue #204
 *
 * Server-side validation for escrow template payloads submitted by clients.
 * Validates:
 *   - milestones array: structure, amounts, non-empty titles
 *   - milestone total must equal the declared totalAmount
 *   - Stellar addresses (client, freelancer, arbiter)
 *   - token ID / asset identifier
 *   - deadline (must be a future ISO date when supplied)
 *
 * All rules run via express-validator chains so error responses are
 * consistent with the rest of the API:
 *   { error: 'Validation failed', details: [{ field, message, location }] }
 */

import { body, validationResult } from 'express-validator';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Stellar public key — G + 55 base-32 characters (uppercase). */
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * Stellar asset identifier — one of:
 *   - "native"  (XLM)
 *   - "CODE:GISSUER..." (alphanumeric code 1–12 chars + colon + valid Stellar address)
 *   - A raw contract ID (C + 55 base-32 chars, Soroban token)
 */
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}:[A-Z2-7]{56}$/;
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

const MAX_MILESTONES = 50;
const MAX_TITLE_LENGTH = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidStellarAddress(value) {
  return STELLAR_ADDRESS_RE.test(value);
}

function isValidTokenId(value) {
  return value === 'native' || ASSET_CODE_RE.test(value) || CONTRACT_ID_RE.test(value);
}

/**
 * Parse a decimal-string amount to a BigInt (stroops or similar integer unit).
 * Returns null if the value is not a valid non-negative decimal string.
 */
function parseAmount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const str = String(value).trim();
  // Allow only digits, one optional decimal point
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  // Normalise to integer-equivalent (multiply by 1e7 to handle up to 7 dp)
  try {
    return BigInt(Math.round(parseFloat(str) * 1e7));
  } catch {
    return null;
  }
}

// ── Validation Chains ─────────────────────────────────────────────────────────

export const escrowTemplateRules = [
  // ── clientAddress ──────────────────────────────────────────────────────────
  body('clientAddress')
    .notEmpty()
    .withMessage('clientAddress is required')
    .isString()
    .withMessage('clientAddress must be a string')
    .custom((v) => {
      if (!isValidStellarAddress(v)) throw new Error('clientAddress must be a valid Stellar address (G...)');
      return true;
    }),

  // ── freelancerAddress ──────────────────────────────────────────────────────
  body('freelancerAddress')
    .notEmpty()
    .withMessage('freelancerAddress is required')
    .isString()
    .withMessage('freelancerAddress must be a string')
    .custom((v) => {
      if (!isValidStellarAddress(v)) throw new Error('freelancerAddress must be a valid Stellar address (G...)');
      return true;
    })
    .custom((v, { req }) => {
      if (v === req.body?.clientAddress)
        throw new Error('freelancerAddress must differ from clientAddress');
      return true;
    }),

  // ── arbiterAddress (optional) ──────────────────────────────────────────────
  body('arbiterAddress')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('arbiterAddress must be a string')
    .custom((v) => {
      if (!isValidStellarAddress(v)) throw new Error('arbiterAddress must be a valid Stellar address (G...)');
      return true;
    }),

  // ── tokenId ───────────────────────────────────────────────────────────────
  body('tokenId')
    .notEmpty()
    .withMessage('tokenId is required')
    .isString()
    .withMessage('tokenId must be a string')
    .custom((v) => {
      if (!isValidTokenId(v))
        throw new Error(
          'tokenId must be "native", a Stellar asset code (e.g. USDC:G...), or a Soroban contract ID (C...)',
        );
      return true;
    }),

  // ── totalAmount ───────────────────────────────────────────────────────────
  body('totalAmount')
    .notEmpty()
    .withMessage('totalAmount is required')
    .custom((v) => {
      if (parseAmount(v) === null) throw new Error('totalAmount must be a positive decimal string');
      if (parseAmount(v) <= 0n) throw new Error('totalAmount must be greater than 0');
      return true;
    }),

  // ── deadline (optional) ───────────────────────────────────────────────────
  body('deadline')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('deadline must be a valid ISO 8601 date string')
    .custom((v) => {
      const d = new Date(v);
      if (d <= new Date()) throw new Error('deadline must be a future date');
      return true;
    }),

  // ── milestones ────────────────────────────────────────────────────────────
  body('milestones')
    .isArray({ min: 1 })
    .withMessage('milestones must be a non-empty array')
    .custom((arr) => {
      if (arr.length > MAX_MILESTONES)
        throw new Error(`milestones may not exceed ${MAX_MILESTONES} entries`);
      return true;
    }),

  body('milestones.*.title')
    .notEmpty()
    .withMessage('each milestone must have a non-empty title')
    .isString()
    .withMessage('milestone title must be a string')
    .isLength({ max: MAX_TITLE_LENGTH })
    .withMessage(`milestone title must not exceed ${MAX_TITLE_LENGTH} characters`),

  body('milestones.*.amount')
    .notEmpty()
    .withMessage('each milestone must have an amount')
    .custom((v) => {
      const parsed = parseAmount(v);
      if (parsed === null) throw new Error('milestone amount must be a positive decimal string');
      if (parsed <= 0n) throw new Error('milestone amount must be greater than 0');
      return true;
    }),

  // ── Cross-field: milestone sum must equal totalAmount ─────────────────────
  body('milestones').custom((milestones, { req }) => {
    const total = parseAmount(req.body?.totalAmount);
    if (total === null) return true; // totalAmount already failed its own rule

    const milestoneSum = milestones.reduce((acc, m) => {
      const a = parseAmount(m?.amount);
      return a !== null ? acc + a : acc;
    }, 0n);

    if (milestoneSum !== total) {
      throw new Error(
        `Sum of milestone amounts (${milestoneSum}) must equal totalAmount (${total})`,
      );
    }
    return true;
  }),
];

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Express middleware that runs escrowTemplateRules and short-circuits with
 * HTTP 400 on any validation error. Mount BEFORE the controller handler.
 *
 * Usage:
 *   router.post('/templates', validateEscrowTemplate, templateController.create);
 */
export async function validateEscrowTemplate(req, res, next) {
  await Promise.all(escrowTemplateRules.map((rule) => rule.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array({ onlyFirstError: false }).map((e) => ({
      field: e.path,
      message: e.msg,
      location: e.location,
    }));
    return res.status(400).json({ error: 'Validation failed', details });
  }
  return next();
}
