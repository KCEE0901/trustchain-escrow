// Manual mock for the 'redis' package.
import { jest } from '@jest/globals';

const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  expire: jest.fn().mockResolvedValue(1),
  sAdd: jest.fn().mockResolvedValue(1),
  sMembers: jest.fn().mockResolvedValue([]),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  on: jest.fn(),
  // Idempotency primitives used by the indexer sync-lag alert path.
  // `set` with NX/EX options returns 'OK' on first write and null when the
  // key already exists, mirroring real Redis semantics for SET NX.
  setNX: jest.fn().mockResolvedValue('OK'),
  eval: jest.fn().mockResolvedValue(1),
};

// Deterministic, concurrency-safe SET NX emulation.
//
// The indexer sync-lag alert path relies on SET NX to guarantee that only one
// of several overlapping workers/requests emits an alert for a given lag
// window. A plain `mockResolvedValue('OK')` would let every concurrent caller
// "win", which hides the very race the coverage is meant to exercise. This
// implementation keeps an in-memory key store so that the first SET NX for a
// key returns 'OK' and every subsequent call (including concurrent ones)
// returns null until the key is deleted or expires.
const store = new Map();

const now = () => Date.now();

const isExpired = (entry) => entry.expiresAt !== null && entry.expiresAt <= now();

const readKey = (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    store.delete(key);
    return null;
  }
  return entry.value;
};

const parseSetOptions = (options) => {
  const opts = { nx: false, ex: null };
  if (!options) return opts;
  if (Array.isArray(options)) {
    for (let i = 0; i < options.length; i += 1) {
      const token = String(options[i]).toUpperCase();
      if (token === 'NX') opts.nx = true;
      if (token === 'EX') {
        const seconds = Number(options[i + 1]);
        opts.ex = Number.isFinite(seconds) ? seconds : null;
        i += 1;
      }
    }
    return opts;
  }
  if (typeof options === 'object') {
    if (options.NX) opts.nx = true;
    if (Number.isFinite(options.EX)) opts.ex = Number(options.EX);
  }
  return opts;
};

// Reset helper so each test starts from a clean, deterministic key space.
mockClient.__resetStore = () => {
  store.clear();
};

// Simulate optional indexer infrastructure being unavailable. When enabled,
// every Redis command used by the sync-lag alert path rejects with a
// deterministic, secret-free error so tests can assert graceful degradation.
let unavailable = false;

mockClient.__setUnavailable = (value) => {
  unavailable = Boolean(value);
};

const unavailableError = () => new Error('redis unavailable');

const guard = (fn) => async (...args) => {
  if (unavailable) throw unavailableError();
  return fn(...args);
};

mockClient.get = jest.fn(guard(async (key) => readKey(key)));

mockClient.set = jest.fn(guard(async (key, value, options) => {
  const { nx, ex } = parseSetOptions(options);
  if (nx && readKey(key) !== null) {
    return null;
  }
  store.set(key, {
    value,
    expiresAt: ex !== null ? now() + ex * 1000 : null,
  });
  return 'OK';
}));

mockClient.setNX = jest.fn(guard(async (key, value) => {
  if (readKey(key) !== null) {
    return null;
  }
  store.set(key, { value, expiresAt: null });
  return 'OK';
}));

mockClient.del = jest.fn(guard(async (key) => {
  const existed = store.delete(key);
  return existed ? 1 : 0;
}));

export const createClient = jest.fn(() => mockClient);
