/**
 * Cache Configuration Validation Tests
 *
 * Verifies that invalid CACHE_TTL_* settings and middleware options fail fast
 * with messages that name the setting but never echo its value.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../lib/cache.js', () => ({ default: {} }));

const { validateCacheConfig, cacheResponse, invalidateOn, MAX_TTL_SECONDS } = await import(
  '../api/middleware/cache.js'
);

test('defaults apply when settings are unset and valid overrides are honoured', () => {
  const ttl = validateCacheConfig({ CACHE_TTL_LIST: ' 20 ', CACHE_TTL_STATIC: '' });
  expect(ttl.LIST).toBe(20);
  expect(ttl.STATIC).toBe(600);
  expect(ttl.DEFAULT).toBe(60);
  expect(Object.isFrozen(ttl)).toBe(true);
});

test.each(['abc', '12abc', '-5', '0', '1.5', String(MAX_TTL_SECONDS + 1)])(
  'rejects CACHE_TTL_DETAIL=%p without echoing the value',
  (value) => {
    let error;
    try {
      validateCacheConfig({ CACHE_TTL_DETAIL: value });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('CACHE_CONFIG_INVALID');
    expect(error.message).toContain('CACHE_TTL_DETAIL');
    expect(error.message).not.toContain(`=${value}`);
    expect(error.message).not.toContain(`"${value}"`);
  },
);

test('cacheResponse rejects invalid options', () => {
  expect(() => cacheResponse({ ttl: 0 })).toThrow(/cacheResponse option "ttl"/);
  expect(() => cacheResponse({ ttl: '30' })).toThrow(/"ttl"/);
  expect(() => cacheResponse({ tags: 'escrows' })).toThrow(/"tags"/);
  expect(() => cacheResponse({ keyFn: 'key' })).toThrow(/"keyFn"/);
  expect(() => cacheResponse({ skip: true })).toThrow(/"skip"/);
  expect(() => cacheResponse({ ttl: 30, tags: ['escrows'] })).not.toThrow();
});

test('invalidateOn rejects an unknown "when" and non-list targets', () => {
  expect(() => invalidateOn({ when: 'later' })).toThrow(/"when" must be "before" or "after"/);
  expect(() => invalidateOn({ keys: 'k1' })).toThrow(/invalidateOn option "keys"/);
  expect(() => invalidateOn({ when: 'before', tags: (req) => [req.params.id] })).not.toThrow();
});
