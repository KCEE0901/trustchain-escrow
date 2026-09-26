/**
 * responseEnvelope.js
 *
 * Wraps every JSON response produced by API routes into a consistent envelope:
 *
 *   Success  →  { data: <original body>, meta: { requestId, timestamp, version } }
 *   Error    →  { error: { code, message, ...extras } }
 *
 * Routes that already emit a top-level `error` key are treated as error
 * responses and are re-wrapped to ensure code/message fields are always
 * present. Routes that omit `data` in their success body are wrapped as-is
 * so existing callers don't need to change at once — they simply gain the
 * `meta` field.
 *
 * Usage (mount before route handlers):
 *   router.use(responseEnvelope);
 */

const API_VERSION = process.env.API_VERSION || 'v1';

/**
 * Patches `res.json` so that the body is re-shaped before it is written to
 * the socket. The patch is applied per-request to avoid global state.
 */
export function responseEnvelope(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function wrappedJson(body) {
    // Only transform plain objects — leave arrays and primitives untouched.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return originalJson(body);
    }

    // Already enveloped by a nested call — don't double-wrap.
    if ('data' in body && 'meta' in body) {
      return originalJson(body);
    }

    const statusCode = res.statusCode || 200;

    // Error response: top-level `error` key or a 4xx/5xx status.
    if ('error' in body || statusCode >= 400) {
      const raw = body.error ?? body;
      const enveloped = {
        error: {
          code: raw?.code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
          message: raw?.message ?? (typeof raw === 'string' ? raw : 'An error occurred'),
          ...(raw && typeof raw === 'object' && !('code' in raw) ? {} : {}),
        },
      };
      // Forward any extra fields from the original error object.
      if (raw && typeof raw === 'object') {
        const { code: _c, message: _m, ...rest } = raw;
        if (Object.keys(rest).length > 0) {
          Object.assign(enveloped.error, rest);
        }
      }
      return originalJson(enveloped);
    }

    // Success response.
    const enveloped = {
      data: 'data' in body ? body.data : body,
      meta: {
        requestId: req.id ?? req.headers['x-request-id'] ?? null,
        timestamp: new Date().toISOString(),
        version: API_VERSION,
      },
    };

    return originalJson(enveloped);
  };

  next();
}

export default responseEnvelope;
