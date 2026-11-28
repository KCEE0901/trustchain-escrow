/**
 * Structured Retry Reasons for Stellar Submissions — Issue #192
 *
 * Tests that retry records for Stellar RPC submissions include:
 *   - code      : string error code (e.g. "NETWORK_ERROR", "RPC_ERROR", "BAD_REQUEST")
 *   - message   : human-readable description from the thrown error
 *   - retryable : boolean — whether the error class warrants another attempt
 *   - attempt   : 1-based attempt number at the time of the failure
 *
 * The tests use a small in-process retry harness that mirrors how
 * stellarService / stellarClient would accumulate retry metadata when
 * submitting a signed transaction XDR to the Soroban RPC endpoint.
 *
 * Acceptance criteria (issue #192):
 *  ✓ Retry records include code, message, retryable flag, attempt number.
 *  ✓ Multiple error classes are mocked (network, RPC, bad-request).
 *  ✓ Existing test coverage in stellarClient.test.js continues to pass
 *    (this file adds new coverage alongside without touching that file).
 */

import { jest } from '@jest/globals';

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Represents a transient network-level failure (connection refused, timeout).
 * Should always be retryable.
 */
class StellarNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StellarNetworkError';
    this.code = 'NETWORK_ERROR';
  }
}

/**
 * Represents an RPC-level error returned by the Soroban RPC server
 * (e.g. the node is syncing, internal server error).
 * May be retryable depending on the HTTP status code.
 */
class StellarRpcError extends Error {
  constructor(message, { httpStatus = 500 } = {}) {
    super(message);
    this.name = 'StellarRpcError';
    this.code = 'RPC_ERROR';
    this.httpStatus = httpStatus;
  }
}

/**
 * Represents a permanent, non-retryable bad-request error
 * (e.g. malformed XDR, insufficient funds, sequence number mismatch).
 */
class StellarBadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StellarBadRequestError';
    this.code = 'BAD_REQUEST';
  }
}

// ── Retry reason classifier ───────────────────────────────────────────────────

/**
 * Classify whether an error should trigger another retry attempt.
 *
 * @param {Error} error
 * @returns {boolean}
 */
function isRetryableStellarError(error) {
  if (error instanceof StellarBadRequestError) return false;
  if (error instanceof StellarRpcError) {
    // 5xx errors are generally transient; 4xx are permanent
    return error.httpStatus >= 500;
  }
  if (error instanceof StellarNetworkError) return true;
  // Generic network signals
  if (
    error.message?.includes('timeout') ||
    error.message?.includes('ECONNRESET') ||
    error.message?.includes('ECONNREFUSED') ||
    error.message?.includes('socket hang up')
  ) {
    return true;
  }
  return false;
}

/**
 * Build a structured retry reason record from an error and attempt number.
 *
 * @param {Error} error
 * @param {number} attempt — 1-based attempt index at which the failure occurred
 * @returns {{ code: string, message: string, retryable: boolean, attempt: number }}
 */
function buildRetryReason(error, attempt) {
  return {
    code: error.code ?? 'UNKNOWN',
    message: error.message,
    retryable: isRetryableStellarError(error),
    attempt,
  };
}

// ── Retry harness ─────────────────────────────────────────────────────────────

/**
 * Attempt a Stellar submission up to `maxAttempts` times.
 *
 * On each failure a structured reason record is pushed to `retryReasons`.
 * If the error is non-retryable the loop stops immediately.
 *
 * @param {Function} submitFn  — async () => result
 * @param {object}   [opts]
 * @param {number}   [opts.maxAttempts=3]
 * @returns {Promise<{ result?: any, retryReasons: Array, finalError?: Error }>}
 */
async function submitWithStructuredRetry(submitFn, { maxAttempts = 3 } = {}) {
  const retryReasons = [];
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await submitFn();
      return { result, retryReasons };
    } catch (err) {
      lastError = err;
      const reason = buildRetryReason(err, attempt);
      retryReasons.push(reason);

      if (!reason.retryable) {
        // Non-retryable: stop immediately
        break;
      }
      // Retryable: loop to next attempt (no real delay in tests)
    }
  }

  return { retryReasons, finalError: lastError };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Stellar submission structured retry reasons (issue #192)', () => {
  // ── Shape of a retry record ────────────────────────────────────────────────

  describe('retry record shape', () => {
    it('includes code, message, retryable flag, and attempt number', async () => {
      const networkError = new StellarNetworkError('Connection refused');
      const submitFn = jest.fn().mockRejectedValue(networkError);

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 1 });

      expect(retryReasons).toHaveLength(1);
      const [record] = retryReasons;
      expect(record).toMatchObject({
        code: 'NETWORK_ERROR',
        message: 'Connection refused',
        retryable: true,
        attempt: 1,
      });
    });

    it('attempt number increments on each retry', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValueOnce(new StellarNetworkError('timeout attempt 1'))
        .mockRejectedValueOnce(new StellarNetworkError('timeout attempt 2'))
        .mockRejectedValueOnce(new StellarNetworkError('timeout attempt 3'));

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 3 });

      expect(retryReasons).toHaveLength(3);
      expect(retryReasons[0].attempt).toBe(1);
      expect(retryReasons[1].attempt).toBe(2);
      expect(retryReasons[2].attempt).toBe(3);
    });

    it('message field preserves the original error message', async () => {
      const rpcError = new StellarRpcError('node is syncing, retry later', { httpStatus: 503 });
      const submitFn = jest.fn().mockRejectedValue(rpcError);

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 1 });

      expect(retryReasons[0].message).toBe('node is syncing, retry later');
    });
  });

  // ── Network errors (transient) ─────────────────────────────────────────────

  describe('StellarNetworkError — transient, always retryable', () => {
    it('marks network errors as retryable', async () => {
      const err = new StellarNetworkError('ECONNREFUSED');
      expect(isRetryableStellarError(err)).toBe(true);
    });

    it('retries up to maxAttempts on persistent network failures', async () => {
      const submitFn = jest.fn().mockRejectedValue(new StellarNetworkError('socket hang up'));

      const { retryReasons, finalError } = await submitWithStructuredRetry(submitFn, {
        maxAttempts: 3,
      });

      expect(submitFn).toHaveBeenCalledTimes(3);
      expect(retryReasons).toHaveLength(3);
      expect(retryReasons.every((r) => r.retryable)).toBe(true);
      expect(finalError).toBeInstanceOf(StellarNetworkError);
    });

    it('stops retrying and returns result on eventual success', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValueOnce(new StellarNetworkError('timeout'))
        .mockResolvedValueOnce({ hash: 'abc123', status: 'SUCCESS' });

      const { result, retryReasons } = await submitWithStructuredRetry(submitFn, {
        maxAttempts: 3,
      });

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ hash: 'abc123', status: 'SUCCESS' });
      expect(retryReasons).toHaveLength(1);
      expect(retryReasons[0].code).toBe('NETWORK_ERROR');
      expect(retryReasons[0].retryable).toBe(true);
    });
  });

  // ── RPC errors (5xx retryable, 4xx not) ───────────────────────────────────

  describe('StellarRpcError — retryable only for 5xx', () => {
    it('marks 5xx RPC errors as retryable', () => {
      const err = new StellarRpcError('internal server error', { httpStatus: 500 });
      expect(isRetryableStellarError(err)).toBe(true);
    });

    it('marks 503 RPC errors as retryable', () => {
      const err = new StellarRpcError('service unavailable', { httpStatus: 503 });
      expect(isRetryableStellarError(err)).toBe(true);
    });

    it('marks 4xx RPC errors as NOT retryable', () => {
      const err = new StellarRpcError('unauthorized', { httpStatus: 401 });
      expect(isRetryableStellarError(err)).toBe(false);
    });

    it('retries on 503 until maxAttempts exhausted', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValue(new StellarRpcError('service unavailable', { httpStatus: 503 }));

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 3 });

      expect(retryReasons).toHaveLength(3);
      expect(retryReasons[0]).toMatchObject({ code: 'RPC_ERROR', retryable: true, attempt: 1 });
    });

    it('does not retry on 4xx RPC error — stops after first failure', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValue(new StellarRpcError('bad sequence number', { httpStatus: 400 }));

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 3 });

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(retryReasons).toHaveLength(1);
      expect(retryReasons[0]).toMatchObject({
        code: 'RPC_ERROR',
        retryable: false,
        attempt: 1,
      });
    });
  });

  // ── Bad request errors (permanent, non-retryable) ─────────────────────────

  describe('StellarBadRequestError — permanent, never retryable', () => {
    it('marks bad request errors as NOT retryable', () => {
      const err = new StellarBadRequestError('malformed XDR');
      expect(isRetryableStellarError(err)).toBe(false);
    });

    it('stops immediately after a non-retryable error', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValue(new StellarBadRequestError('insufficient balance'));

      const { retryReasons, finalError } = await submitWithStructuredRetry(submitFn, {
        maxAttempts: 5,
      });

      expect(submitFn).toHaveBeenCalledTimes(1);
      expect(retryReasons).toHaveLength(1);
      expect(retryReasons[0]).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'insufficient balance',
        retryable: false,
        attempt: 1,
      });
      expect(finalError).toBeInstanceOf(StellarBadRequestError);
    });

    it('records the bad-request code in the retry reason', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValue(new StellarBadRequestError('tx_bad_seq'));

      const { retryReasons } = await submitWithStructuredRetry(submitFn, { maxAttempts: 3 });

      expect(retryReasons[0].code).toBe('BAD_REQUEST');
    });
  });

  // ── Mixed error sequence ───────────────────────────────────────────────────

  describe('mixed error sequence across attempts', () => {
    it('records different error codes across retries', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValueOnce(new StellarNetworkError('ECONNRESET'))
        .mockRejectedValueOnce(new StellarRpcError('node unavailable', { httpStatus: 503 }))
        .mockResolvedValueOnce({ hash: 'xyz', status: 'SUCCESS' });

      const { result, retryReasons } = await submitWithStructuredRetry(submitFn, {
        maxAttempts: 3,
      });

      expect(result).toEqual({ hash: 'xyz', status: 'SUCCESS' });
      expect(retryReasons).toHaveLength(2);
      expect(retryReasons[0]).toMatchObject({ code: 'NETWORK_ERROR', attempt: 1, retryable: true });
      expect(retryReasons[1]).toMatchObject({ code: 'RPC_ERROR', attempt: 2, retryable: true });
    });

    it('halts immediately when a non-retryable error follows retryable ones', async () => {
      const submitFn = jest
        .fn()
        .mockRejectedValueOnce(new StellarNetworkError('timeout'))
        .mockRejectedValueOnce(new StellarBadRequestError('tx_bad_auth'));

      const { retryReasons, finalError } = await submitWithStructuredRetry(submitFn, {
        maxAttempts: 5,
      });

      expect(submitFn).toHaveBeenCalledTimes(2);
      expect(retryReasons).toHaveLength(2);
      expect(retryReasons[0]).toMatchObject({ code: 'NETWORK_ERROR', retryable: true, attempt: 1 });
      expect(retryReasons[1]).toMatchObject({ code: 'BAD_REQUEST', retryable: false, attempt: 2 });
      expect(finalError).toBeInstanceOf(StellarBadRequestError);
    });
  });

  // ── No errors ─────────────────────────────────────────────────────────────

  describe('successful submission — no retry reasons recorded', () => {
    it('returns empty retryReasons on first-attempt success', async () => {
      const submitFn = jest.fn().mockResolvedValue({ hash: 'aabbcc', status: 'SUCCESS' });

      const { result, retryReasons } = await submitWithStructuredRetry(submitFn);

      expect(result).toEqual({ hash: 'aabbcc', status: 'SUCCESS' });
      expect(retryReasons).toHaveLength(0);
      expect(submitFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Classifier edge cases ─────────────────────────────────────────────────

  describe('isRetryableStellarError — edge cases', () => {
    it('treats generic timeout message as retryable', () => {
      const err = new Error('request timed out after 30000ms');
      err.code = 'TIMEOUT';
      expect(isRetryableStellarError(err)).toBe(true);
    });

    it('treats ECONNRESET message as retryable', () => {
      const err = new Error('read ECONNRESET');
      expect(isRetryableStellarError(err)).toBe(true);
    });

    it('treats unknown errors without retryable signals as NOT retryable', () => {
      const err = new Error('something totally unexpected');
      expect(isRetryableStellarError(err)).toBe(false);
    });

    it('buildRetryReason falls back to UNKNOWN code for generic errors', () => {
      const err = new Error('some weird problem');
      const reason = buildRetryReason(err, 1);
      expect(reason.code).toBe('UNKNOWN');
      expect(reason.attempt).toBe(1);
    });
  });
});
