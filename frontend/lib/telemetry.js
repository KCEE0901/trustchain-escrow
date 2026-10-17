/**
 * Privacy-safe interaction telemetry helper.
 *
 * Emits deterministic, privacy-safe interaction events for design-token
 * consistency measurement (issue #542). This module:
 *
 *   - Is a no-op on the server (no `window`).
 *   - Never throws (all failures are swallowed).
 *   - Strips wallet addresses (Stellar `G...`/`M...` keys), signatures,
 *     tokens, and any sensitive fields before forwarding.
 *   - Produces stable output for identical inputs.
 *
 * Events are forwarded to the existing performance buffer via
 * `trackCustomMetric` when available, otherwise to the analytics endpoint.
 */

import { trackCustomMetric } from './performance';

/**
 * Keys that must never be forwarded, regardless of value.
 * Matched case-insensitively against the (normalized) key name.
 */
const SENSITIVE_KEY_DENYLIST = [
  'address',
  'wallet',
  'signature',
  'token',
  'secret',
  'privatekey',
  'payload',
];

/**
 * Patterns for sensitive values that may appear inside otherwise
 * innocuous strings.
 */
const SENSITIVE_VALUE_PATTERNS = [
  // Stellar public keys (G...) and muxed account keys (M...).
  /\b[GM][A-Z2-7]{55}\b/g,
  // Stellar secret seeds (S...).
  /\bS[A-Z2-7]{55}\b/g,
  // Generic bearer tokens / long hex or base64-ish blobs.
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Fa-f0-9]{64,}\b/g,
];

const REDACTED = '[redacted]';

/**
 * Normalizes an event name or outcome into a deterministic, safe token.
 * Lowercases, trims, and replaces non-alphanumeric runs with `_`.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeToken(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized : fallback;
}

/**
 * Returns true when a key matches the sensitive-field denylist.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_DENYLIST.some((denied) => normalized.includes(denied));
}

/**
 * Redacts sensitive value patterns from a string.
 *
 * @param {string} value
 * @returns {string}
 */
function redactString(value) {
  let result = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Recursively sanitizes a value so it is safe to forward.
 * Handles primitives, arrays, plain objects, and cycles.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} seen
 * @returns {unknown}
 */
function sanitizeValue(value, seen) {
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;

  if (type === 'string') {
    return redactString(value);
  }

  if (type === 'number' || type === 'boolean') {
    return value;
  }

  if (type === 'bigint') {
    return value.toString();
  }

  if (type === 'function' || type === 'symbol') {
    return undefined;
  }

  if (type !== 'object') {
    return undefined;
  }

  if (seen.has(value)) {
    return REDACTED;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const result = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    const sanitized = sanitizeValue(value[key], seen);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

/**
 * Sanitizes the metadata object, dropping sensitive keys and redacting
 * sensitive values. Returns a new object with sorted keys for stable output.
 *
 * @param {unknown} meta
 * @returns {Record<string, unknown>}
 */
function sanitizeMeta(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return {};
  }

  const sanitized = sanitizeValue(meta, new WeakSet());

  if (sanitized === null || typeof sanitized !== 'object') {
    return {};
  }

  // Sort keys for deterministic output.
  const sorted = {};
  for (const key of Object.keys(sanitized).sort()) {
    sorted[key] = sanitized[key];
  }
  return sorted;
}

/**
 * Forwards a sanitized event to the analytics endpoint.
 * Fire-and-forget; never throws.
 *
 * @param {Record<string, unknown>} event
 */
function forwardToEndpoint(event) {
  try {
    if (typeof fetch !== 'function') {
      return;
    }
    const endpoint = '/api/analytics/interaction';
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {
      // Swallow network errors; telemetry must never break the app.
    });
  } catch {
    // Swallow any synchronous errors.
  }
}

/**
 * Tracks a privacy-safe interaction event.
 *
 * @param {string} eventName - Human-readable event name (normalized).
 * @param {string} outcome - Outcome label, e.g. "success" | "failure".
 * @param {Record<string, unknown>} [meta] - Optional metadata; sensitive
 *   fields are stripped and sensitive values redacted.
 * @returns {void}
 */
export function trackInteraction(eventName, outcome, meta) {
  try {
    // No-op on the server.
    if (typeof window === 'undefined') {
      return;
    }

    const name = normalizeToken(eventName, 'unknown_event');
    const result = normalizeToken(outcome, 'unknown_outcome');
    const safeMeta = sanitizeMeta(meta);

    const event = {
      event: name,
      outcome: result,
      meta: safeMeta,
    };

    // Prefer the existing performance buffer.
    if (typeof trackCustomMetric === 'function') {
      try {
        trackCustomMetric(`interaction.${name}.${result}`, 1, safeMeta);
        return;
      } catch {
        // Fall through to the analytics endpoint.
      }
    }

    forwardToEndpoint(event);
  } catch {
    // Telemetry must never throw.
  }
}

export default trackInteraction;