import { renderHook, act, waitFor } from '@testing-library/react';
import { useReputation } from '../hooks/useReputation';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';

/**
 * Build a deterministic reputation payload for a given address.
 */
function buildReputation(address, overrides = {}) {
  return {
    address,
    score: 42,
    level: 'trusted',
    ...overrides,
  };
}

/**
 * Create a deferred promise whose resolution we can control from the test.
 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Install a controllable matchMedia mock. Returns helpers to flip the
 * preference and dispatch change events.
 */
function installMatchMedia(initialMatches = false) {
  const listeners = new Set();
  const mql = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: jest.fn((event, handler) => {
      if (event === 'change') listeners.add(handler);
    }),
    removeEventListener: jest.fn((event, handler) => {
      if (event === 'change') listeners.delete(handler);
    }),
    addListener: jest.fn((handler) => listeners.add(handler)),
    removeListener: jest.fn((handler) => listeners.delete(handler)),
    dispatchEvent: jest.fn(),
  };

  const matchMedia = jest.fn(() => mql);
  window.matchMedia = matchMedia;

  function setMatches(next) {
    mql.matches = next;
    listeners.forEach((handler) => handler({ matches: next, media: mql.media }));
  }

  return { mql, matchMedia, setMatches, listeners };
}

// ---------------------------------------------------------------------------
// Global setup
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
  window.matchMedia = originalMatchMedia;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReputation', () => {
  describe('success path', () => {
    it('fetches reputation and exposes derived badge', async () => {
      installMatchMedia(false);

      const reputation = buildReputation(ADDRESS_A);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => reputation,
      });

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      // Initial loading state.
      expect(result.current.loading).toBe(true);
      expect(result.current.reputation).toBeNull();
      expect(result.current.error).toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.reputation).toEqual(reputation);
      expect(result.current.error).toBeNull();
      expect(result.current.badge).toBeDefined();
      expect(result.current.badge).toEqual(
        expect.objectContaining({ level: 'trusted' })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('stale-response cancellation', () => {
    it('does not let a slow earlier fetch overwrite a newer fetch result', async () => {
      installMatchMedia(false);

      const first = createDeferred();
      const second = createDeferred();

      const firstReputation = buildReputation(ADDRESS_A, { score: 1 });
      const secondReputation = buildReputation(ADDRESS_B, { score: 99 });

      let call = 0;
      global.fetch = jest.fn(() => {
        call += 1;
        if (call === 1) {
          return first.promise;
        }
        return second.promise;
      });

      const { result, rerender } = renderHook(
        ({ address }) => useReputation(address),
        { initialProps: { address: ADDRESS_A } }
      );

      // Trigger a second fetch by changing the address.
      rerender({ address: ADDRESS_B });

      // Resolve the newer request first.
      await act(async () => {
        second.resolve({
          ok: true,
          status: 200,
          json: async () => secondReputation,
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.reputation).toEqual(secondReputation);
      });

      // Now resolve the stale first request — it must be ignored.
      await act(async () => {
        first.resolve({
          ok: true,
          status: 200,
          json: async () => firstReputation,
        });
        await Promise.resolve();
      });

      expect(result.current.reputation).toEqual(secondReputation);
      expect(result.current.reputation).not.toEqual(firstReputation);
      expect(result.current.error).toBeNull();
    });
  });

  describe('abort behavior', () => {
    it('aborts the in-flight request on unmount', async () => {
      installMatchMedia(false);

      const abortSpy = jest.fn();
      const OriginalAbortController = global.AbortController;
      global.AbortController = jest.fn(() => ({
        signal: { aborted: false },
        abort: abortSpy,
      }));

      global.fetch = jest.fn(() => new Promise(() => {}));

      const { unmount } = renderHook(() => useReputation(ADDRESS_A));

      unmount();

      expect(abortSpy).toHaveBeenCalledTimes(1);

      global.AbortController = OriginalAbortController;
    });

    it('aborts the previous request when the address changes', async () => {
      installMatchMedia(false);

      const abortSpy = jest.fn();
      const OriginalAbortController = global.AbortController;
      global.AbortController = jest.fn(() => ({
        signal: { aborted: false },
        abort: abortSpy,
      }));

      global.fetch = jest.fn(() => new Promise(() => {}));

      const { rerender } = renderHook(
        ({ address }) => useReputation(address),
        { initialProps: { address: ADDRESS_A } }
      );

      rerender({ address: ADDRESS_B });

      expect(abortSpy).toHaveBeenCalledTimes(1);

      global.AbortController = OriginalAbortController;
    });
  });

  describe('error path', () => {
    it('exposes a sanitized deterministic error message', async () => {
      installMatchMedia(false);

      const secret = 'super-secret-token-abc123';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: `boom ${secret}` }),
      });

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.reputation).toBeNull();
      expect(result.current.error).toBeTruthy();
      expect(typeof result.current.error).toBe('string');
      // Deterministic and free of secrets.
      expect(result.current.error).not.toContain(secret);
      expect(result.current.error).not.toMatch(/token|secret/i);
    });

    it('handles network rejection without leaking internals', async () => {
      installMatchMedia(false);

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET at 10.0.0.1'));

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.reputation).toBeNull();
      expect(result.current.error).toBeTruthy();
      expect(result.current.error).not.toContain('10.0.0.1');
      expect(result.current.error).not.toContain('ECONNRESET');
    });
  });

  describe('reduced motion', () => {
    it('reflects reducedMotion = true when the preference is set', () => {
      installMatchMedia(true);

      global.fetch = jest.fn(() => new Promise(() => {}));

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      expect(result.current.reducedMotion).toBe(true);
    });

    it('reflects reducedMotion = false when the preference is not set', () => {
      installMatchMedia(false);

      global.fetch = jest.fn(() => new Promise(() => {}));

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      expect(result.current.reducedMotion).toBe(false);
    });

    it('updates reducedMotion when the media query changes', () => {
      const { setMatches } = installMatchMedia(false);

      global.fetch = jest.fn(() => new Promise(() => {}));

      const { result } = renderHook(() => useReputation(ADDRESS_A));

      expect(result.current.reducedMotion).toBe(false);

      act(() => {
        setMatches(true);
      });

      expect(result.current.reducedMotion).toBe(true);

      act(() => {
        setMatches(false);
      });

      expect(result.current.reducedMotion).toBe(false);
    });
  });
});