/**
 * Cache Graceful Degradation Tests
 *
 * Verifies that an unavailable cache backend never fails the request, never
 * serves another tenant's entry, and logs without keys, values or error text.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

const mockLog = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => mockLog,
}));

const store = new Map();
const mockCache = {
  get: jest.fn(async (key) => store.get(key) ?? null),
  setWithTags: jest.fn(async (key, value) => store.set(key, value)),
  invalidate: jest.fn(async () => {}),
  invalidatePrefix: jest.fn(async () => {}),
  invalidateTags: jest.fn(async () => {}),
};
jest.unstable_mockModule('../lib/cache.js', () => ({ default: mockCache }));

const { cacheResponse, invalidateOn, buildCacheKey } = await import('../api/middleware/cache.js');

const TENANT_A = { id: 'tid-aaa', slug: 'alpha' };
const TENANT_B = { id: 'tid-bbb', slug: 'beta' };
const outage = () => Promise.reject(new Error('ECONNREFUSED t:alpha:http:GET:/api/escrows'));

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

function expectSafeLogs(operation) {
  expect(mockLog.warn).toHaveBeenCalledWith({ message: 'cache_backend_unavailable', operation });
  const logged = JSON.stringify(mockLog.warn.mock.calls);
  expect(logged).not.toMatch(/alpha|beta|tid-|ECONNREFUSED/);
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

test('healthy backend still serves the tenant\'s own cached entry', async () => {
  store.set(buildCacheKey(makeReq(TENANT_A)), { data: 'A' });
  const res = makeRes();
  await cacheResponse()(makeReq(TENANT_A), res, jest.fn());

  expect(res.headers['X-Cache']).toBe('HIT');
  expect(res.json).toHaveBeenCalledWith({ data: 'A' });
  expect(mockLog.warn).not.toHaveBeenCalled();
});

test('read failure passes through to the handler and never serves cross-tenant data', async () => {
  store.set(buildCacheKey(makeReq(TENANT_A)), { data: 'A' });
  mockCache.get.mockImplementationOnce(outage);
  const res = makeRes();
  const originalJson = res.json;
  const next = jest.fn();

  await cacheResponse()(makeReq(TENANT_B), res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.headers['X-Cache']).toBe('BYPASS');
  expect(res.headers['X-Cache-Key']).toBeUndefined();
  expect(res.json).toBe(originalJson);
  expect(originalJson).not.toHaveBeenCalled();
  expect(mockCache.setWithTags).not.toHaveBeenCalled();
  expectSafeLogs('get');
});

test('write failure still returns the handler response', async () => {
  mockCache.setWithTags.mockImplementationOnce(outage);
  const res = makeRes();
  const originalJson = res.json;
  await cacheResponse({ ttl: 30 })(makeReq(TENANT_A), res, jest.fn());

  await expect(res.json({ data: 'fresh' })).resolves.toBe(res);
  expect(originalJson).toHaveBeenCalledWith({ data: 'fresh' });
  expectSafeLogs('set');
});

test('invalidation failure before the handler does not block the request', async () => {
  mockCache.invalidateTags.mockImplementationOnce(outage);
  const next = jest.fn();
  await invalidateOn({ tags: ['escrows'], when: 'before' })(makeReq(TENANT_A, 'POST'), makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expectSafeLogs('invalidate');
});

test('post-response invalidation failure is logged without leaking details', async () => {
  mockCache.invalidateTags.mockImplementationOnce(outage);
  const res = makeRes();
  invalidateOn({ tags: ['escrows'] })(makeReq(TENANT_A, 'POST'), res, jest.fn());
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));

  expectSafeLogs('invalidate');
});
