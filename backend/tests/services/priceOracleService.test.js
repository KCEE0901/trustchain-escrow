import { jest } from '@jest/globals';
import { getPrice, convert, clearCache } from '../../services/priceOracleService.js';

beforeEach(() => clearCache());

describe('priceOracleService — null/undefined consistency', () => {
  it('returns null when the asset code is null or undefined', async () => {
    expect(await getPrice(null, jest.fn())).toBeNull();
    expect(await getPrice(undefined, jest.fn())).toBeNull();
  });

  it('returns null when the fetcher resolves to null or undefined', async () => {
    expect(await getPrice('XLM', async () => null)).toBeNull();
    expect(await getPrice('USDC', async () => undefined)).toBeNull();
  });

  it('returns null when the fetcher throws', async () => {
    const fetcher = async () => {
      throw new Error('feed down');
    };
    expect(await getPrice('XLM', fetcher)).toBeNull();
  });

  // Regression: a previous inconsistent truthy check (`if (!price)`) treated
  // a legitimate price of exactly 0 as "missing" and re-fetched every call
  // instead of caching it, and downstream conversions silently no-op'd.
  it('treats a valid price of 0 as a real value, not a missing one', async () => {
    const fetcher = jest.fn().mockResolvedValue(0);

    const first = await getPrice('DEADCOIN', fetcher);
    const second = await getPrice('DEADCOIN', fetcher);

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('caches a successful fetch and does not call the fetcher again within TTL', async () => {
    const fetcher = jest.fn().mockResolvedValue(0.42);

    await getPrice('XLM', fetcher);
    await getPrice('XLM', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('priceOracleService.convert', () => {
  it('returns null if any required input is null or undefined', () => {
    expect(convert(null, 1, 1)).toBeNull();
    expect(convert(10, null, 1)).toBeNull();
    expect(convert(10, 1, undefined)).toBeNull();
  });

  it('returns null instead of dividing by a zero destination price', () => {
    expect(convert(10, 1, 0)).toBeNull();
  });

  it('converts correctly for valid, non-zero prices', () => {
    expect(convert(10, 2, 4)).toBe(5);
  });
});
