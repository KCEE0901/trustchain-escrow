/**
 * Tests for backend/services/lockManager.js
 */

import { jest } from '@jest/globals';

// ── Mock ioredis ──────────────────────────────────────────────────────────────

const mockRedis = {
  set: jest.fn(),
  eval: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.unstable_mockModule('ioredis', () => ({
  default: jest.fn(() => mockRedis),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

const { default: LockManager } = await import('../services/lockManager.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LockManager.acquire', () => {
  it('returns a Lock when Redis SET NX succeeds', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const lock = await LockManager.acquire('test_lock', 5000, { autoRenew: false });

    expect(lock).not.toBeNull();
    expect(mockRedis.set).toHaveBeenCalledWith('test_lock', expect.any(String), 'PX', 5000, 'NX');
  });

  it('returns null when the lock is already held (SET NX returns null)', async () => {
    mockRedis.set.mockResolvedValue(null);

    const lock = await LockManager.acquire('test_lock', 5000, { autoRenew: false });

    expect(lock).toBeNull();
  });

  it('returns null and logs a warning when Redis throws', async () => {
    mockRedis.set.mockRejectedValue(new Error('connection refused'));

    const lock = await LockManager.acquire('test_lock', 5000, { autoRenew: false });

    expect(lock).toBeNull();
  });
});

describe('Lock.release', () => {
  it('calls the Lua release script with the correct token', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockResolvedValue(1);

    const lock = await LockManager.acquire('rel_lock', 5000, { autoRenew: false });
    await lock.release();

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("del"'),
      1,
      'rel_lock',
      expect.any(String),
    );
  });

  it('is safe to call multiple times (idempotent)', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockResolvedValue(1);

    const lock = await LockManager.acquire('idem_lock', 5000, { autoRenew: false });
    await lock.release();
    await lock.release(); // second call should not throw

    expect(mockRedis.eval).toHaveBeenCalledTimes(2);
  });

  it('does not throw when Redis eval fails during release', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockRejectedValue(new Error('redis down'));

    const lock = await LockManager.acquire('err_lock', 5000, { autoRenew: false });
    await expect(lock.release()).resolves.toBeUndefined();
  });
});

describe('Lock auto-renewal', () => {
  it('calls the Lua renew script at 50% of TTL', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockResolvedValue(1);

    const ttl = 10_000;
    const lock = await LockManager.acquire('renew_lock', ttl, { autoRenew: true });

    // Advance time past the renewal interval (50% of TTL)
    jest.advanceTimersByTime(ttl * 0.5 + 100);
    await Promise.resolve(); // flush microtasks

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('pexpire'),
      1,
      'renew_lock',
      expect.any(String),
      String(ttl),
    );

    await lock.release();
  });

  it('stops renewal when the lock is no longer owned (eval returns 0)', async () => {
    mockRedis.set.mockResolvedValue('OK');
    // First eval call = renewal returns 0 (lock stolen)
    mockRedis.eval.mockResolvedValue(0);

    const ttl = 10_000;
    await LockManager.acquire('stolen_lock', ttl, { autoRenew: true });

    jest.advanceTimersByTime(ttl * 0.5 + 100);
    await Promise.resolve();

    // Only one renewal attempt should have been made
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });
});

describe('Lock lease renewal (simulated Redis)', () => {
  // Minimal in-memory Redis honouring SET NX PX and the release/renew Lua scripts
  let store;

  function live(key) {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  beforeEach(() => {
    store = new Map();
    mockRedis.set.mockImplementation(async (key, token, _px, ttl) => {
      if (live(key)) return null;
      store.set(key, { token, expiresAt: Date.now() + Number(ttl) });
      return 'OK';
    });
    mockRedis.eval.mockImplementation(async (script, _n, key, token, ttl) => {
      const entry = live(key);
      if (!entry || entry.token !== token) return 0;
      if (script.includes('pexpire')) {
        entry.expiresAt = Date.now() + Number(ttl);
        return 1;
      }
      store.delete(key);
      return 1;
    });
  });

  it('keeps the lease alive past its original TTL while renewals succeed', async () => {
    const ttl = 1_000;
    const lock = await LockManager.acquire('lease', ttl, { autoRenew: true });

    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(ttl * 0.5);
      await flush();
    }

    expect(await LockManager.acquire('lease', ttl, { autoRenew: false })).toBeNull();
    await lock.release();
    expect(store.has('lease')).toBe(false);
  });

  it('fails renewal after expiry and stops renewing', async () => {
    const ttl = 1_000;
    const lock = await LockManager.acquire('expiring', ttl, { autoRenew: false });

    jest.advanceTimersByTime(ttl + 1);
    lock.startRenewal();
    jest.advanceTimersByTime(ttl * 0.5);
    await flush();

    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    expect(store.has('expiring')).toBe(false);

    jest.advanceTimersByTime(ttl * 2);
    await flush();
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
  });

  it('prevents a competing worker from acquiring until the lease expires', async () => {
    const ttl = 1_000;
    await LockManager.acquire('shared', ttl, { autoRenew: false });

    jest.advanceTimersByTime(ttl - 1);
    expect(await LockManager.acquire('shared', ttl, { autoRenew: false })).toBeNull();

    jest.advanceTimersByTime(2);
    expect(await LockManager.acquire('shared', ttl, { autoRenew: false })).not.toBeNull();
  });

  it('does not let a non-owner release the current holder lease', async () => {
    const ttl = 1_000;
    const stale = await LockManager.acquire('owned', ttl, { autoRenew: false });

    jest.advanceTimersByTime(ttl + 1);
    const current = await LockManager.acquire('owned', ttl, { autoRenew: false });
    const currentToken = store.get('owned').token;

    await stale.release();
    expect(store.get('owned')?.token).toBe(currentToken);
    expect(await LockManager.acquire('owned', ttl, { autoRenew: false })).toBeNull();

    await current.release();
    expect(store.has('owned')).toBe(false);
  });
});

describe('LockManager.disconnect', () => {
  it('calls quit on the Redis client', async () => {
    await LockManager.disconnect();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
