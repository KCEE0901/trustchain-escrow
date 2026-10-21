import crypto from 'crypto';

const cache = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

// Bound only payment checkout replay records. They are short-lived operational
// entries, not financial records. Never evict a valid record to admit a new one.
const checkoutReplayKeys = new Set();
const CHECKOUT_REPLAY_TTL_DEFAULT = 24 * 60 * 60 * 1000;
function checkoutLimit(name, fallback, low, high) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) < low || Number(raw) > high) {
    throw new Error(`${name} must be an integer between ${low} and ${high}`);
  }
  return Number(raw);
}
function isCheckoutRequest(req) {
  return req.method === 'POST' && req.path === '/checkout' &&
    /(?:^|\/)payments$/.test(req.baseUrl || '');
}
function evictCheckoutReplay(cacheKey, expected) {
  if (cache.get(cacheKey) !== expected) return;
  cache.delete(cacheKey);
  checkoutReplayKeys.delete(cacheKey);
}
function pruneExpiredCheckoutReplays(now) {
  for (const key of checkoutReplayKeys) {
    const entry = cache.get(key);
    if (!entry || (!entry.inFlight && entry.expiresAt <= now)) {
      cache.delete(key);
      checkoutReplayKeys.delete(key);
    }
  }
}


const fingerprint = (body) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');

export const idempotencyMiddleware = (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key || !['POST', 'PATCH', 'PUT'].includes(req.method)) return next();
  const checkout = isCheckoutRequest(req);
  const ttl = checkout ? checkoutLimit('PAYMENT_REPLAY_TTL_MS', CHECKOUT_REPLAY_TTL_DEFAULT, 60000, 604800000) : TTL_MS;
  const maxKeys = checkout ? checkoutLimit('PAYMENT_REPLAY_MAX_KEYS', 5000, 1, 100000) : 0;
  if (checkout) pruneExpiredCheckoutReplays(Date.now());

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

  if (checkout && checkoutReplayKeys.size >= maxKeys) {
    return res.status(503).json({ error: { code: 'PAYMENT_REPLAY_CAPACITY', message: 'Retry the request later' } });
  }
  const inflight = { inFlight: true, requestHash };
  cache.set(cacheKey, inflight);
  if (checkout) checkoutReplayKeys.add(cacheKey);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) {
      evictCheckoutReplay(cacheKey, cache.get(cacheKey));
    } else {
      const entry = { inFlight: false, requestHash, status: res.statusCode,
        body, expiresAt: Date.now() + ttl };
      cache.set(cacheKey, entry);
      setTimeout(() => {
        if (checkout) evictCheckoutReplay(cacheKey, entry);
        else if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
      }, ttl).unref?.();
    }
    return originalJson(body);
  };

  // Release the key if the request ends without a JSON response (e.g. an error).
  res.on('finish', () => {
    if (cache.get(cacheKey)?.inFlight) evictCheckoutReplay(cacheKey, cache.get(cacheKey));
  });

  next();
};

export const _resetIdempotencyCache = () => { cache.clear(); checkoutReplayKeys.clear(); };
