/**
 * Cache Tenant Concurrency Tests
 *
 * Exercises overlapping requests from different tenants against the same
 * path and verifies that no tenant ever observes another tenant's entry and
 * that outcomes are deterministic regardless of completion order.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const store = new Map();
const tagIndex = new Map();
const mockCache = {
  get: jest.fn(async (key) => {
    await new Promise((resolve) => setImmediate(resolve));
    return store.get(key) ?? null;
  }),
  setWithTags: jest.fn(async (key, value, _ttl, tags) => {
    await new Promise((resolve) => setImmediate(resolve));
    store.set(key, value);
    for (const tag of tags) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
      tagIndex.get(tag).add(key);
    }
  }),
  invalidate: jest.fn(async (key) => store.delete(key)),
  invalidatePrefix: jest.fn(async () => {}),
  invalidateTags: jest.fn(async (tags) => {
    for (const tag of tags) {
      for (const key of tagIndex.get(tag) ?? []) store.delete(key);
      tagIndex.delete(tag);
    }
  }),
};

jest.unstable_mockModule('../lib/cache.js', () => ({ default: mockCache }));

const { cacheResponse, invalidateOn } = await import('../api/middleware/cache.js');

const TENANTS = [
  { id: 'tid-aaa', slug: 'alpha' },
  { id: 'tid-bbb', slug: 'beta' },
  { id: 'tid-ccc', slug: 'gamma' },
];

function makeReq(tenant, method = 'GET') {
  return { method, path: '/api/reputation/leaderboard', query: { page: '1' }, tenant };
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.sent = [];
  res.json = (body) => {
    res.sent.push(body);
    return res;
  };
  return res;
}

const payloadFor = (tenant) => ({ tenant: tenant.slug, data: [`${tenant.slug}-row`] });

/** Runs one request through the middleware; the handler responds after `delay` ticks. */
function request(mw, tenant, delay = 0) {
  const res = makeRes();
  return new Promise((resolve) => {
    const next = () => {
      let ticks = delay;
      const tick = () => {
        if (ticks-- > 0) return setImmediate(tick);
        Promise.resolve(res.json(payloadFor(tenant))).then(() => resolve(res));
      };
      tick();
    };
    Promise.resolve(mw(makeReq(tenant), res, next)).then(() => {
      if (res.headers['X-Cache'] === 'HIT') resolve(res);
    });
  });
}

beforeEach(() => {
  store.clear();
  tagIndex.clear();
  jest.clearAllMocks();
});

test('overlapping misses from different tenants each receive and store their own data', async () => {
  const mw = cacheResponse({ ttl: 60, tags: ['reputation:leaderboard'] });

  // Completion order is the reverse of arrival order.
  const results = await Promise.all(TENANTS.map((t, i) => request(mw, t, TENANTS.length - i)));

  results.forEach((res, i) => {
    expect(res.headers['X-Cache']).toBe('MISS');
    expect(res.sent).toEqual([payloadFor(TENANTS[i])]);
  });
  expect(mockCache.setWithTags).toHaveBeenCalledTimes(TENANTS.length);
  for (const t of TENANTS) {
    const key = [...store.keys()].find((k) => k.startsWith(`t:${t.slug}:`));
    expect(store.get(key)).toEqual(payloadFor(t));
  }
});

test('interleaved hits and misses never serve another tenant\'s entry', async () => {
  const mw = cacheResponse({ ttl: 60 });
  await request(mw, TENANTS[0]);

  // Tenant A hits while B and C overlap on misses for the same path.
  const [a, b, c, a2] = await Promise.all([
    request(mw, TENANTS[0]),
    request(mw, TENANTS[1], 2),
    request(mw, TENANTS[2], 1),
    request(mw, TENANTS[0]),
  ]);

  expect(a.headers['X-Cache']).toBe('HIT');
  expect(a2.headers['X-Cache']).toBe('HIT');
  expect(a.sent).toEqual([payloadFor(TENANTS[0])]);
  expect(a2.sent).toEqual([payloadFor(TENANTS[0])]);
  expect(b.sent).toEqual([payloadFor(TENANTS[1])]);
  expect(c.sent).toEqual([payloadFor(TENANTS[2])]);
});

test('concurrent same-tenant misses coalesce without leaking into other tenants', async () => {
  const mw = cacheResponse({ ttl: 60 });

  const [a1, a2, b1] = await Promise.all([
    request(mw, TENANTS[0], 2),
    request(mw, TENANTS[0], 2),
    request(mw, TENANTS[1], 1),
  ]);

  expect(a1.sent).toEqual([payloadFor(TENANTS[0])]);
  expect(a2.sent).toEqual([payloadFor(TENANTS[0])]);
  expect(b1.sent).toEqual([payloadFor(TENANTS[1])]);
  expect(mockCache.setWithTags).toHaveBeenCalledTimes(2);
});

test('one tenant\'s invalidation during another tenant\'s miss leaves the other entry intact', async () => {
  const mw = cacheResponse({ ttl: 60, tags: ['reputation:leaderboard'] });
  await request(mw, TENANTS[0]);

  const invalidate = invalidateOn({ tags: ['reputation:leaderboard'], when: 'before' });
  const [b] = await Promise.all([
    request(mw, TENANTS[1], 1),
    invalidate(makeReq(TENANTS[0], 'POST'), makeRes(), () => {}),
  ]);

  expect(b.sent).toEqual([payloadFor(TENANTS[1])]);
  const keys = [...store.keys()];
  expect(keys.some((k) => k.startsWith('t:alpha:'))).toBe(false);
  expect(keys.some((k) => k.startsWith('t:beta:'))).toBe(true);
});

test('repeated overlapping runs produce identical outcomes', async () => {
  const snapshots = [];
  for (let run = 0; run < 3; run++) {
    store.clear();
    tagIndex.clear();
    const mw = cacheResponse({ ttl: 60 });
    const results = await Promise.all(TENANTS.map((t, i) => request(mw, t, (i * 7) % 3)));
    snapshots.push(results.map((r) => r.sent));
  }
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[2]).toEqual(snapshots[0]);
});
