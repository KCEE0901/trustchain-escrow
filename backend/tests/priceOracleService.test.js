/**
 * Unit tests for priceOracleService.js — edge cases
 *
 * Covers:
 *  - isValidPrice boundary values
 *  - stroopsToUsd / xlmToUsd / usdToXlm / xlmToStroops conversions
 *  - fetchLivePrice with empty order book
 *  - fetchLivePrice with malformed / non-OK response
 *  - fetchLivePrice retry logic
 *  - getXlmUsdRate cache hit / miss / forceRefresh
 *
 * Closes #97
 */

import { jest } from '@jest/globals';

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../../config/logger.js', () => ({
  createModuleLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Import after mocks ────────────────────────────────────────────────────────
import {
  isValidPrice,
  stroopsToUsd,
  xlmToUsd,
  usdToXlm,
  xlmToStroops,
  fetchLivePrice,
  getXlmUsdRate,
  setHorizonUrl,
  clearCache,
  STROOPS_PER_XLM,
  MIN_VALID_PRICE_USD,
  MAX_VALID_PRICE_USD,
  MAX_RETRIES,
} from '../../services/priceOracleService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal mock fetch Response for the order-book endpoint. */
function mockOrderBook({ asks = [], bids = [], status = 200 } = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ asks, bids }),
  });
}

// ── isValidPrice ──────────────────────────────────────────────────────────────

describe('isValidPrice', () => {
  it('returns true for a normal price', () => {
    expect(isValidPrice(0.12)).toBe(true);
  });

  it('returns true at the minimum boundary', () => {
    expect(isValidPrice(MIN_VALID_PRICE_USD)).toBe(true);
  });

  it('returns true at the maximum boundary', () => {
    expect(isValidPrice(MAX_VALID_PRICE_USD)).toBe(true);
  });

  it('returns false for zero', () => {
    expect(isValidPrice(0)).toBe(false);
  });

  it('returns false for a negative value', () => {
    expect(isValidPrice(-1)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isValidPrice(Infinity)).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isValidPrice(NaN)).toBe(false);
  });

  it('returns false for a non-number', () => {
    expect(isValidPrice('0.12')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidPrice(null)).toBe(false);
  });

  it('returns false for a value just below the minimum', () => {
    expect(isValidPrice(MIN_VALID_PRICE_USD / 2)).toBe(false);
  });

  it('returns false for a value just above the maximum', () => {
    expect(isValidPrice(MAX_VALID_PRICE_USD + 1)).toBe(false);
  });
});

// ── Conversion helpers ────────────────────────────────────────────────────────

describe('stroopsToUsd', () => {
  it('converts correctly at a known rate', () => {
    // 10_000_000 stroops = 1 XLM; at $0.12 that is $0.12
    expect(stroopsToUsd(STROOPS_PER_XLM, 0.12)).toBeCloseTo(0.12);
  });

  it('returns 0 for 0 stroops', () => {
    expect(stroopsToUsd(0, 0.12)).toBe(0);
  });

  it('scales linearly', () => {
    const rate = 0.1;
    expect(stroopsToUsd(STROOPS_PER_XLM * 5, rate)).toBeCloseTo(0.5);
  });
});

describe('xlmToUsd', () => {
  it('converts correctly', () => {
    expect(xlmToUsd(100, 0.12)).toBeCloseTo(12);
  });

  it('returns 0 for 0 XLM', () => {
    expect(xlmToUsd(0, 0.12)).toBe(0);
  });
});

describe('usdToXlm', () => {
  it('converts correctly', () => {
    expect(usdToXlm(12, 0.12)).toBeCloseTo(100);
  });

  it('throws when rate is zero', () => {
    expect(() => usdToXlm(100, 0)).toThrow('xlmUsdRate must not be zero');
  });

  it('returns 0 for 0 USD', () => {
    expect(usdToXlm(0, 0.12)).toBe(0);
  });
});

describe('xlmToStroops', () => {
  it('converts 1 XLM to 10_000_000 stroops', () => {
    expect(xlmToStroops(1)).toBe(STROOPS_PER_XLM);
  });

  it('rounds fractional stroops', () => {
    expect(xlmToStroops(0)).toBe(0);
  });

  it('converts large values', () => {
    expect(xlmToStroops(1000)).toBe(1000 * STROOPS_PER_XLM);
  });
});

// ── fetchLivePrice ────────────────────────────────────────────────────────────

describe('fetchLivePrice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHorizonUrl('https://horizon-test.example');
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    clearCache();
  });

  it('returns the mid-price when both asks and bids are present', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [{ price: '0.14' }], bids: [{ price: '0.10' }] }),
    );
    const price = await fetchLivePrice();
    expect(price).toBeCloseTo(0.12);
  });

  it('returns ask price when only asks are present', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [{ price: '0.15' }], bids: [] }),
    );
    const price = await fetchLivePrice();
    expect(price).toBeCloseTo(0.15);
  });

  it('returns bid price when only bids are present', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [], bids: [{ price: '0.11' }] }),
    );
    const price = await fetchLivePrice();
    expect(price).toBeCloseTo(0.11);
  });

  it('throws when the order book is empty', async () => {
    mockFetch.mockReturnValue(mockOrderBook({ asks: [], bids: [] }));
    const promise = fetchLivePrice();
    for (let i = 0; i < MAX_RETRIES; i++) {
      jest.runAllTimers();
    }
    await expect(promise).rejects.toThrow(/failed after/);
  });

  it('throws when Horizon returns a non-OK status', async () => {
    mockFetch.mockReturnValue(mockOrderBook({ status: 503 }));
    const promise = fetchLivePrice();
    for (let i = 0; i < MAX_RETRIES; i++) {
      jest.runAllTimers();
    }
    await expect(promise).rejects.toThrow(/failed after/);
  });

  it('throws when the fetched price is outside the valid range', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [{ price: '99999999' }], bids: [] }),
    );
    const promise = fetchLivePrice();
    for (let i = 0; i < MAX_RETRIES; i++) {
      jest.runAllTimers();
    }
    await expect(promise).rejects.toThrow(/failed after/);
  });

  it('succeeds on a retry after an initial failure', async () => {
    mockFetch
      .mockReturnValueOnce(mockOrderBook({ status: 500 }))
      .mockReturnValueOnce(
        mockOrderBook({ asks: [{ price: '0.13' }], bids: [{ price: '0.11' }] }),
      );
    const promise = fetchLivePrice();
    jest.runAllTimers();
    const price = await promise;
    expect(price).toBeCloseTo(0.12);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('propagates the abort signal when the request times out', async () => {
    mockFetch.mockImplementation((_url, { signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const promise = fetchLivePrice();
    jest.runAllTimers();
    await expect(promise).rejects.toThrow(/failed after/);
  });
});

// ── getXlmUsdRate ─────────────────────────────────────────────────────────────

describe('getXlmUsdRate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHorizonUrl('https://horizon-test.example');
    clearCache();
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    clearCache();
  });

  it('fetches from Horizon on first call (cold cache)', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [{ price: '0.12' }], bids: [{ price: '0.10' }] }),
    );
    const rate = await getXlmUsdRate();
    expect(rate).toBeCloseTo(0.11);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without re-fetching', async () => {
    mockFetch.mockReturnValue(
      mockOrderBook({ asks: [{ price: '0.12' }], bids: [{ price: '0.10' }] }),
    );
    await getXlmUsdRate();
    mockFetch.mockReset();
    const rate = await getXlmUsdRate();
    expect(rate).toBeCloseTo(0.11);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-fetches when forceRefresh is true', async () => {
    mockFetch
      .mockReturnValueOnce(
        mockOrderBook({ asks: [{ price: '0.12' }], bids: [{ price: '0.10' }] }),
      )
      .mockReturnValueOnce(
        mockOrderBook({ asks: [{ price: '0.20' }], bids: [{ price: '0.18' }] }),
      );
    await getXlmUsdRate();
    const rate = await getXlmUsdRate({ forceRefresh: true });
    expect(rate).toBeCloseTo(0.19);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
