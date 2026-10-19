/**
 * HTTP Response Cache Middleware
 *
 * Drop-in Express middleware that caches GET responses and handles
 * cache invalidation for mutating requests.
 *
 * ## Usage
 *
 * ### Cache a route
 *
 *   import { cacheResponse } from '../middleware/cache.js';
 *
 *   router.get('/', cacheResponse({ ttl: 30, tags: ['escrows'] }), controller.list);
 *   router.get('/:id', cacheResponse({ ttl: 60, tags: req => [`escrow:${req.params.id}`] }), controller.get);
 *
 * ### Invalidate on mutation
 *
 *   import { invalidateOn } from '../middleware/cache.js';
 *
 *   router.post('/', invalidateOn({ tags: ['escrows'] }), controller.create);
 *   router.patch('/:id', invalidateOn({ tags: req => [`escrow:${req.params.id}`, 'escrows'] }), controller.update);
 *
 * ## Cache key
 *
 * Default: `t:<tenant-slug>:http:<method>:<path>:<sha256-query-16chars>`
 * Public (tenantless) routes fall back to `t:_global:...`.
 * Override with the `keyFn` option — custom keyFn MUST include tenant context
 * to avoid cross-tenant collisions.
 *
 * ## TTL configuration
 *
 * Per-route TTL via the `ttl` option (seconds).
 * Global defaults via environment variables:
 *
 *   CACHE_TTL_DEFAULT=60
 *   CACHE_TTL_LIST=15
 *   CACHE_TTL_DETAIL=30
 *   CACHE_TTL_LEADERBOARD=300
 *   CACHE_TTL_EVENTS=15
 *
 * @module middleware/cache
 */

import { createHash } from 'crypto';
import cache from '../../lib/cache.js';
import { createSingleFlight } from '../../lib/operationalControls.js';

// ── TTL presets (overridable via env) ─────────────────────────────────────────

export const TTL = {
  DEFAULT: parseInt(process.env.CACHE_TTL_DEFAULT || '60', 10),
  LIST: parseInt(process.env.CACHE_TTL_LIST || '15', 10),
  DETAIL: parseInt(process.env.CACHE_TTL_DETAIL || '30', 10),
  LEADERBOARD: parseInt(process.env.CACHE_TTL_LEADERBOARD || '300', 10),
  EVENTS: parseInt(process.env.CACHE_TTL_EVENTS || '15', 10),
  REPUTATION: parseInt(process.env.CACHE_TTL_REPUTATION || '60', 10),
  STATIC: parseInt(process.env.CACHE_TTL_STATIC || '600', 10),
};

// ── Key builder ───────────────────────────────────────────────────────────────

/**
 * Builds a deterministic cache key from the request, scoped by tenant slug.
 *
 * Keys are prefixed with `t:<slug>:` so two tenants requesting the same path
 * never collide. The `_global` sentinel is used for requests that have no
 * tenant (health checks, public metrics).
 *
 * Query params are sorted and SHA-256 hashed (first 16 hex chars) to keep
 * long query strings from bloating Redis key storage.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function buildCacheKey(req) {

  const tenantSlug = req.tenant?.slug ?? '_global';
  const sortedQuery = Object.keys(req.query)
    .sort()
    .map((k) => `${k}=${req.query[k]}`)
    .join('&');
  const queryPart = sortedQuery
    ? ':' + createHash('sha256').update(sortedQuery).digest('hex').slice(0, 16)
    : '';
  return `t:${tenantSlug}:http:${req.method}:${req.path}${queryPart}`;
}

/**
 * Prefixes a tag with the request's tenant id so Tenant A's tag invalidation
 * never touches Tenant B's cached entries.
 * Falls back to the bare tag for tenantless (public) routes.
 *
 * @param {string} tag
 * @param {import('express').Request} req
 * @returns {string}
 */
function tenantTag(tag, req) {
  const tenantId = req.tenant?.id;
  return tenantId ? `t:${tenantId}:${tag}` : tag;
}

// ── Cache response middleware ─────────────────────────────────────────────────

/** Coalesces concurrent misses per tenant-scoped cache key. */
const inflightMisses = createSingleFlight();

/**
 * @typedef {Object} CacheOptions
 * @property {number}                          [ttl]    — TTL in seconds (default: TTL.DEFAULT)
 * @property {string[]|(req)=>string[]}        [tags]   — invalidation tags
 * @property {(req)=>string}                   [keyFn]  — custom key builder
 * @property {(req,res)=>boolean}              [skip]   — return true to bypass cache
 */

/**
 * Middleware that serves cached responses for GET requests and stores
 * fresh responses in the cache after the controller runs.
 *
 * @param {CacheOptions} [options]
 * @returns {import('express').RequestHandler}
 */
export function cacheResponse(options = {}) {
  const { ttl = TTL.DEFAULT, tags = [], keyFn = buildCacheKey, skip } = options;

  return async (req, res, next) => {
    // Only cache GET / HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Allow per-request bypass (e.g. authenticated writes, admin routes)
    if (skip && skip(req, res)) return next();

    const key = keyFn(req);

    // ── Cache hit ─────────────────────────────────────────────────────────────
    const cached = await cache.get(key);
    if (cached !== null) return sendHit(res, key, cached);

    // ── Concurrent miss for the same tenant-scoped key ────────────────────────
    // Another request is already producing this entry: reuse its result rather
    // than running the handler and cache write a second time.
    if (inflightMisses.has(key)) {
      const shared = await inflightMisses(key, () => undefined);
      if (shared !== undefined) return sendHit(res, key, shared);
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Key', key);
      return next();
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Cache-Key', key);

    // Leader: followers receive the cached body, or undefined when the handler
    // did not produce a cacheable response (they then run the handler themselves).
    let settle;
    const outcome = new Promise((resolve) => {
      settle = resolve;
    });
    inflightMisses(key, () => outcome);
    res.on('finish', () => settle(undefined));
    res.on('close', () => settle(undefined));

    // ── Intercept res.json to store the response (at most once) ───────────────
    const originalJson = res.json.bind(res);
    let handled = false;
    res.json = async (body) => {
      if (!handled) {
        handled = true;
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok) {
          const resolvedTags = (typeof tags === 'function' ? tags(req) : tags).map((t) =>
            tenantTag(t, req),
          );
          await cache.setWithTags(key, body, ttl, resolvedTags);
        }
        settle(ok ? body : undefined);
      }
      return originalJson(body);
    };

    next();
  };
}

function sendHit(res, key, body) {
  res.setHeader('X-Cache', 'HIT');
  res.setHeader('X-Cache-Key', key);
  return res.json(body);
}

// ── Invalidation middleware ───────────────────────────────────────────────────

/**
 * @typedef {Object} InvalidateOptions
 * @property {string[]|(req)=>string[]}  [tags]     — tags to invalidate
 * @property {string[]|(req)=>string[]}  [keys]     — exact keys to invalidate
 * @property {string[]|(req)=>string[]}  [prefixes] — prefix patterns to invalidate
 * @property {'before'|'after'}          [when]     — 'before' (default) or 'after' the handler
 */

/**
 * Middleware that invalidates cache entries before or after a mutating request.
 *
 * @param {InvalidateOptions} [options]
 * @returns {import('express').RequestHandler}
 */
export function invalidateOn(options = {}) {
  const { tags = [], keys = [], prefixes = [], when = 'after' } = options;

  const doInvalidate = async (req) => {
    // Deduplicate so a repeated tag/key/prefix is only invalidated once per request.
    const resolvedTags = unique((typeof tags === 'function' ? tags(req) : tags).map((t) =>
      tenantTag(t, req),
    ));
    const resolvedKeys = unique(typeof keys === 'function' ? keys(req) : keys);
    const resolvedPrefixes = unique(typeof prefixes === 'function' ? prefixes(req) : prefixes);

    await Promise.all([
      resolvedTags.length ? cache.invalidateTags(resolvedTags) : Promise.resolve(),
      ...resolvedKeys.map((k) => cache.invalidate(k)),
      ...resolvedPrefixes.map((p) => cache.invalidatePrefix(p)),
    ]);
  };

  if (when === 'before') {
    return async (req, _res, next) => {
      await doInvalidate(req);
      next();
    };
  }

  // 'after' — invalidate once the response has been sent (once per request)
  return (req, res, next) => {
    let invalidated = false;
    res.on('finish', () => {
      if (!invalidated && res.statusCode >= 200 && res.statusCode < 300) {
        invalidated = true;
        doInvalidate(req).catch((err) =>
          console.error('[Cache] Post-response invalidation failed:', err.message),
        );
      }
    });
    next();
  };
}

function unique(values) {
  return [...new Set(values)];
}

// ── Convenience factories ─────────────────────────────────────────────────────

/** Cache a list endpoint (short TTL, tagged with a collection name). */
export const cacheList = (collection, ttl = TTL.LIST) => cacheResponse({ ttl, tags: [collection] });

/** Cache a detail endpoint (medium TTL, tagged with item + collection). */
export const cacheDetail = (collection, idFn, ttl = TTL.DETAIL) =>
  cacheResponse({
    ttl,
    tags: (req) => [collection, `${collection}:${idFn(req)}`],
  });

/** Invalidate a collection and optionally a specific item. */
export const invalidateCollection = (collection, idFn = null) =>
  invalidateOn({
    tags: (req) => [collection, ...(idFn ? [`${collection}:${idFn(req)}`] : [])],
  });
