import crypto from 'crypto';

const cache = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

const fingerprint = (body) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');

export const idempotencyMiddleware = (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key || !['POST', 'PATCH', 'PUT'].includes(req.method)) return next();

  const scope = req.user?.address || req.user?.userId || req.ip || 'anonymous';
  const cacheKey = `${scope}:${req.method}:${req.baseUrl}${req.path}:${key}`;
  const requestHash = fingerprint(req.body);
  const cached = cache.get(cacheKey);

  if (cached) {
    if (cached.requestHash !== requestHash)
      return res.status(422).json({
        error: {
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency key was already used with a different request payload',
        },
      });
    if (cached.inFlight)
      return res.status(409).json({
        error: {
          code: 'REQUEST_IN_FLIGHT',
          message: 'A request with this idempotency key is already in progress',
        },
      });
    res.set('Idempotent-Replayed', 'true');
    return res.status(cached.status).json(cached.body);
  }

  cache.set(cacheKey, { inFlight: true, requestHash });

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) {
      cache.delete(cacheKey);
    } else {
      cache.set(cacheKey, { inFlight: false, requestHash, status: res.statusCode, body });
      setTimeout(() => cache.delete(cacheKey), TTL_MS).unref?.();
    }
    return originalJson(body);
  };

  // Release the key if the request ends without a JSON response (e.g. an error).
  res.on('finish', () => {
    if (cache.get(cacheKey)?.inFlight) cache.delete(cacheKey);
  });

  next();
};

export const _resetIdempotencyCache = () => cache.clear();
