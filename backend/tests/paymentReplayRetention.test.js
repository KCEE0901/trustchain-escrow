import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { idempotencyMiddleware, _resetIdempotencyCache } from '../lib/idempotency.js';

function checkout(key, body = { amountUsd: 10 }, completed = true) {
  const listeners = {};
  const req = {
    headers: { 'idempotency-key': key }, method: 'POST', baseUrl: '/api/payments',
    path: '/checkout', body, user: { address: 'GTEST' },
  };
  const res = {
    statusCode: 200, headers: {}, on(event, fn) { listeners[event] = fn; },
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; listeners.finish?.(); return this; },
  };
  let proceeded = false;
  idempotencyMiddleware(req, res, () => { proceeded = true; });
  if (proceeded && completed) res.json({ sessionId: 'session-test' });
  return { res, proceeded };
}

describe('checkout idempotency retention (#445)', () => {
  const ttl = process.env.PAYMENT_REPLAY_TTL_MS;
  const max = process.env.PAYMENT_REPLAY_MAX_KEYS;
  beforeEach(() => { _resetIdempotencyCache(); jest.useFakeTimers(); });
  afterEach(() => {
    _resetIdempotencyCache(); jest.useRealTimers();
    if (ttl === undefined) delete process.env.PAYMENT_REPLAY_TTL_MS;
    else process.env.PAYMENT_REPLAY_TTL_MS = ttl;
    if (max === undefined) delete process.env.PAYMENT_REPLAY_MAX_KEYS;
    else process.env.PAYMENT_REPLAY_MAX_KEYS = max;
  });

  test('replays one successful submission without repeating the side effect', () => {
    expect(checkout('k1').proceeded).toBe(true);
    const replay = checkout('k1');
    expect(replay.proceeded).toBe(false);
    expect(replay.res.headers['Idempotent-Replayed']).toBe('true');
  });
  test('rejects reused keys with different request bodies', () => {
    checkout('k1');
    expect(checkout('k1', { amountUsd: 20 }).res.statusCode).toBe(422);
  });
  test('expired entries can be cleaned and reused', () => {
    process.env.PAYMENT_REPLAY_TTL_MS = '60000';
    checkout('k1');
    jest.advanceTimersByTime(60001);
    expect(checkout('k1').proceeded).toBe(true);
  });
  test('capacity fails closed rather than evicting unexpired replay records', () => {
    process.env.PAYMENT_REPLAY_MAX_KEYS = '1';
    checkout('k1');
    const blocked = checkout('k2');
    expect(blocked.proceeded).toBe(false);
    expect(blocked.res.statusCode).toBe(503);
    expect(checkout('k1').res.headers['Idempotent-Replayed']).toBe('true');
  });
  test('in-flight requests are not reclaimed under capacity pressure', () => {
    process.env.PAYMENT_REPLAY_MAX_KEYS = '1';
    checkout('k1', { amountUsd: 10 }, false);
    expect(checkout('k2').res.statusCode).toBe(503);
    expect(checkout('k1').res.statusCode).toBe(409);
  });
  test('invalid configuration fails without disclosing values', () => {
    process.env.PAYMENT_REPLAY_TTL_MS = 'invalid-secret';
    expect(() => checkout('k1')).toThrow(/PAYMENT_REPLAY_TTL_MS/);
  });
});
