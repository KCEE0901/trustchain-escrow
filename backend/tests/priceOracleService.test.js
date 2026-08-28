/**
 * Price Oracle Service Tests
 *
 * Covers:
 *   - validatePriceData — valid and invalid inputs
 *   - formatPrice — decimal formatting, zero, large numbers
 *   - fetchPrice — success, network failure, malformed response
 *   - getPrice — cache hit within TTL, re-fetch after TTL expires
 */

import { jest } from '@jest/globals';

// ── Logger mock ──────────────────────────────────────────────────────────────

jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// ── Module under test (imported after mocks) ─────────────────────────────────

const {
  validatePriceData,
  formatPrice,
  fetchPrice,
  getPrice,
} = await import('../services/priceOracleService.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid price data object.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
function makeValidData(overrides = {}) {
  return {
    asset: 'XLM',
    price: 0.1234,
    timestamp: new Date().toISOString(),
    source: 'https://oracle.example.com',
    ...overrides,
  };
}

/**
 * Create a minimal fetch Response-like object.
 *
 * @param {object} body   - Object to JSON-serialise as the response body.
 * @param {number} status - HTTP status code.
 * @returns {object}
 */
function mockFetchResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // Reset the module-level cache between tests by re-importing is not needed —
  // each fetchPrice call is intercepted; the getPrice TTL tests control time
  // via Date.now spy instead.
});

// ── validatePriceData ────────────────────────────────────────────────────────

describe('validatePriceData', () => {
  it('returns valid=true for a complete, well-formed object', () => {
    const result = validatePriceData(makeValidData());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid=false for null input', () => {
    const result = validatePriceData(null);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid=false for undefined input', () => {
    const result = validatePriceData(undefined);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns an error when the "price" field is missing', () => {
    const data = makeValidData();
    delete data.price;

    const result = validatePriceData(data);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('price'))).toBe(true);
  });

  it('returns an error when "price" is a non-numeric string', () => {
    const result = validatePriceData(makeValidData({ price: 'not-a-number' }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('price'))).toBe(true);
  });

  it('returns an error when "price" is NaN', () => {
    const result = validatePriceData(makeValidData({ price: NaN }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('price'))).toBe(true);
  });

  it('returns an error when "price" is negative', () => {
    const result = validatePriceData(makeValidData({ price: -1 }));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('negative') || e.includes('price'))).toBe(true);
  });

  it('returns an error when the "asset" field is missing', () => {
    const data = makeValidData();
    delete data.asset;

    const result = validatePriceData(data);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('asset'))).toBe(true);
  });

  it('returns an error when the "timestamp" field is missing', () => {
    const data = makeValidData();
    delete data.timestamp;

    const result = validatePriceData(data);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('timestamp'))).toBe(true);
  });
});

// ── formatPrice ──────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('formats a number to the specified number of decimal places', () => {
    expect(formatPrice(1.23456789, 4)).toBe('1.2346');
    expect(formatPrice(1.23456789, 2)).toBe('1.23');
    expect(formatPrice(1.23456789, 0)).toBe('1');
  });

  it('defaults to 2 decimal places', () => {
    expect(formatPrice(3.14159)).toBe('3.14');
  });

  it('handles zero correctly', () => {
    expect(formatPrice(0, 2)).toBe('0.00');
    expect(formatPrice(0, 6)).toBe('0.000000');
  });

  it('handles very large numbers without exponential notation', () => {
    const result = formatPrice(1_000_000_000, 2);

    expect(result).toBe('1000000000.00');
    expect(result).not.toContain('e');
  });
});

// ── fetchPrice ───────────────────────────────────────────────────────────────

describe('fetchPrice', () => {
  beforeEach(() => {
    process.env.PRICE_ORACLE_URL = 'https://oracle.example.com/prices';
  });

  afterEach(() => {
    delete process.env.PRICE_ORACLE_URL;
  });

  it('returns a price object on a successful oracle response', async () => {
    const oracleBody = makeValidData({ asset: 'XLM', price: 0.12, timestamp: '2026-01-01T00:00:00Z' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse(oracleBody));

    const result = await fetchPrice('XLM');

    expect(result).toHaveProperty('asset', 'XLM');
    expect(result).toHaveProperty('price', 0.12);
    expect(result).toHaveProperty('timestamp', '2026-01-01T00:00:00Z');
    expect(result).toHaveProperty('source');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('XLM'),
    );
  });

  it('throws a descriptive error on a network failure', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchPrice('XLM')).rejects.toThrow(
      /Network error.*XLM.*ECONNREFUSED/i,
    );
  });

  it('throws a descriptive error when the oracle returns a non-2xx HTTP status', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, 503));

    await expect(fetchPrice('XLM')).rejects.toThrow(/HTTP 503.*XLM/i);
  });

  it('throws a descriptive error when the response body is not valid JSON', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });

    await expect(fetchPrice('XLM')).rejects.toThrow(/could not be parsed as JSON/i);
  });

  it('throws a descriptive error when the response is missing required fields', async () => {
    // Return a body that is missing "price"
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ asset: 'XLM', timestamp: '2026-01-01T00:00:00Z' }),
    );

    await expect(fetchPrice('XLM')).rejects.toThrow(/missing required fields/i);
  });
});

// ── getPrice ─────────────────────────────────────────────────────────────────

describe('getPrice', () => {
  beforeEach(() => {
    process.env.PRICE_ORACLE_URL = 'https://oracle.example.com/prices';
  });

  afterEach(() => {
    delete process.env.PRICE_ORACLE_URL;
  });

  it('returns the cached value and does not re-fetch within the TTL', async () => {
    const oracleBody = makeValidData({ asset: 'XLM', price: 0.5 });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse(oracleBody));

    // Prime the cache
    const first = await getPrice('XLM');
    // Fetch again immediately — should use cache
    const second = await getPrice('XLM');

    expect(first.price).toBe(0.5);
    expect(second.price).toBe(0.5);
    // fetch should have been called exactly once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL has expired', async () => {
    const firstBody = makeValidData({ asset: 'XLM', price: 0.5 });
    const secondBody = makeValidData({ asset: 'XLM', price: 0.9 });

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockFetchResponse(firstBody))
      .mockResolvedValueOnce(mockFetchResponse(secondBody));

    // Stub Date.now to simulate the passage of time
    const realNow = Date.now;
    const baseTime = realNow();
    const nowSpy = jest.spyOn(Date, 'now');

    // First call — time is T+0, prime the cache
    nowSpy.mockReturnValue(baseTime);
    const first = await getPrice('XLM');

    // Second call — time is T+61s, TTL has expired
    nowSpy.mockReturnValue(baseTime + 61_000);
    const second = await getPrice('XLM');

    expect(first.price).toBe(0.5);
    expect(second.price).toBe(0.9);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });
});
