/** Matches a valid Stellar public (G-address): G + 55 Base32 chars (A-Z, 2-7). */
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * Returns true if the given string is a valid Stellar G-address.
 * Trims whitespace before checking so copy-paste errors are handled gracefully.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isValidStellarAddress(address) {
  if (typeof address !== 'string') return false;
  return STELLAR_ADDRESS_RE.test(address.trim());
}

// ── Escrow wizard field validators ────────────────────────────────────────────
// Each function returns an error string on failure, or null on success.

/**
 * Validates a Stellar address field, returning an inline error message or null.
 *
 * @param {string} value      — raw field value (may have surrounding whitespace)
 * @param {string} fieldName  — human-readable field name used in the message
 * @returns {string|null}
 */
export function validateStellarAddressField(value, fieldName) {
  if (!value || !value.trim()) return `${fieldName} is required.`;
  if (!isValidStellarAddress(value)) return 'Invalid Stellar address.';
  return null;
}

/**
 * Validates that an XLM/token amount is a positive number.
 *
 * @param {string|number} value
 * @param {string} [fieldName='Amount']
 * @returns {string|null}
 */
export function validatePositiveAmount(value, fieldName = 'Amount') {
  const n = parseFloat(value);
  if (value === '' || value === null || value === undefined) return `${fieldName} is required.`;
  if (isNaN(n) || n <= 0) return `${fieldName} must be a positive number.`;
  return null;
}

/**
 * Validates that the sum of milestone amounts equals the given total.
 * Pass totalAmount as null/undefined to skip the sum check (e.g. when total
 * is not tracked separately at the milestone step).
 *
 * @param {Array<{amount: string|number}>} milestones
 * @param {number|null|undefined} totalAmount
 * @returns {string|null}
 */
export function validateMilestoneAmounts(milestones, totalAmount) {
  if (!milestones || milestones.length === 0) return 'Add at least one milestone.';

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m.description || !m.description.trim())
      return `Milestone ${i + 1}: description is required.`;
    const amt = parseFloat(m.amount);
    if (!m.amount || isNaN(amt) || amt <= 0)
      return `Milestone ${i + 1}: amount must be greater than zero.`;
  }

  if (totalAmount != null) {
    const sum = milestones.reduce((acc, m) => acc + (parseFloat(m.amount) || 0), 0);
    // Use a small epsilon to account for floating-point rounding.
    if (Math.abs(sum - totalAmount) > 0.0000001) {
      return 'Milestone amounts must sum to total.';
    }
  }

  return null;
}
