/**
 * Cache Idempotency Tests
 *
 * Verifies that concurrent misses for the same tenant-scoped key run the
 * handler and cache write only once, and that invalidation is idempotent.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const store = new Map();
const mockCache = {
  get: jest.fn(async (key) => store.get(key) ?? null),
  setWithTags: jest.fn(async (key, value) => store.set(key, value)),
  invalidate: jest.fn(async (key) => store.delete(key)),
  invalidatePrefix: jest.fn(async () => {}),
  invalidateTags: jest.fn(async () => {}),
};

jest.unstable_mockModule('../lib/cache.js', () => ({ default: mockCache }));

const { cacheResponse, invalidateOn } = await import('../api/middleware/cache.js');

const TENANT_A = { id: 'tid-aaa', slug: 'alpha' };
const TENANT_B = { id: 'tid-bbb', slug: 'beta' };

function makeReq(tenant, method = 'GET') {
  return { method, path: '/api/escrows', query: {}, tenant };
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.json = jest.fn(() => res);
  return res;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

test('concurrent misses for the same tenant key run the handler and cache write once', async () => {
  const mw = cacheResponse({ ttl: 30, tags: ['escrows'] });
  const handler = jest.fn();
  const leader = makeRes();
  const follower = makeRes();
  const followerJson = follower.json;

  await mw(makeReq(TENANT_A), leader, handler);
  const followerDone = mw(makeReq(TENANT_A), follower, handler);
  await flush();

  expect(handler).toHaveBeenCalledTimes(1);
  await leader.json({ data: ['a'] });
  await followerDone;

  expect(mockCache.setWithTags).toHaveBeenCalledTimes(1);
  expect(follower.headers['X-Cache']).toBe('HIT');
  expect(followerJson).toHaveBeenCalledWith({ data: ['a'] });
  expect(handler).toHaveBeenCalledTimes(1);
});

test('followers fall through to the handler when the leader response is not cacheable', async () => {
  const mw = cacheResponse({ ttl: 30 });
  const leaderNext = jest.fn();
  const followerNext = jest.fn();
  const leader = makeRes();
  const follower = makeRes();

  await mw(makeReq(TENANT_A), leader, leaderNext);
  const followerDone = mw(makeReq(TENANT_A), follower, followerNext);
  leader.statusCode = 500;
  await leader.json({ error: 'boom' });
  await followerDone;

  expect(mockCache.setWithTags).not.toHaveBeenCalled();
  expect(follower.headers['X-Cache']).toBe('MISS');
  expect(followerNext).toHaveBeenCalledTimes(1);
});

test('followers are released when the leader finishes without res.json', async () => {
  const mw = cacheResponse({ ttl: 30 });
  const leader = makeRes();
  const followerNext = jest.fn();

  await mw(makeReq(TENANT_A), leader, jest.fn());
  const followerDone = mw(makeReq(TENANT_A), makeRes(), followerNext);
  leader.emit('close');
  await followerDone;

  expect(followerNext).toHaveBeenCalledTimes(1);
});

test('repeated res.json calls write the cache entry only once', async () => {
  const mw = cacheResponse({ ttl: 30 });
  const res = makeRes();
  await mw(makeReq(TENANT_A), res, jest.fn());

  await res.json({ n: 1 });
  await res.json({ n: 2 });

  expect(mockCache.setWithTags).toHaveBeenCalledTimes(1);
  expect(mockCache.setWithTags.mock.calls[0][1]).toEqual({ n: 1 });
});

test('concurrent misses from different tenants are never coalesced', async () => {
  const mw = cacheResponse({ ttl: 30 });
  const nextA = jest.fn();
  const nextB = jest.fn();
  const resA = makeRes();
  const resB = makeRes();

  await mw(makeReq(TENANT_A), resA, nextA);
  await mw(makeReq(TENANT_B), resB, nextB);

  expect(nextA).toHaveBeenCalledTimes(1);
  expect(nextB).toHaveBeenCalledTimes(1);
  resA.emit('close');
  resB.emit('close');
});

test('invalidation deduplicates targets and runs once per request', async () => {
  const mw = invalidateOn({ tags: ['escrows', 'escrows'], keys: ['k1', 'k1'] });
  const res = makeRes();
  mw(makeReq(TENANT_A, 'POST'), res, jest.fn());

  res.emit('finish');
  res.emit('finish');
  await flush();

  expect(mockCache.invalidateTags).toHaveBeenCalledTimes(1);
  expect(mockCache.invalidateTags).toHaveBeenCalledWith([`t:${TENANT_A.id}:escrows`]);
  expect(mockCache.invalidate).toHaveBeenCalledTimes(1);
});
