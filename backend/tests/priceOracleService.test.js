/**
 * Integration tests for priceOracleService.js — issue #228
 *
 * Exercises the full happy-path flow:
 *   1. fetchXlmUsdPrice  — fetches from Stellar Horizon order book
 *   2. getXlmUsdPrice    — returns cached price within TTL
 *   3. usdToXlm          — converts USD → XLM string
 *   4. xlmToUsd          — converts XLM → USD float
 */

import { jest } from '@jest/globals';

// ── fetch mock ─────────────────────────────────────────────────────────────────
const fetchMock = jest.fn();
global.fetch = fetchMock;

// ── env ───────────────────────────────────────────────────────────────────────
process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
process.env.USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const priceOracleService = (await import('../services/priceOracleService.js')).default;

function makeHorizonResponse(price) {
  return {
    ok: true,
    json: async () => ({ bids: [{ price: String(price) }] }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  priceOracleService.__resetCacheForTests();
});

describe('priceOracleService — happy-path flow', () => {
  it('fetchXlmUsdPrice returns XLM/USD price as a float', async () => {
    fetchMock.mockResolvedValueOnce(makeHorizonResponse('0.10'));

    const price = await priceOracleService.fetchXlmUsdPrice();

    expect(typeof price).toBe('number');
    expect(price).toBeCloseTo(0.10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('horizon-testnet.stellar.org');
    expect(fetchMock.mock.calls[0][0]).toContain('order_book');
  });

  it('getXlmUsdPrice fetches from Horizon on first call', async () => {
    fetchMock.mockResolvedValueOnce(makeHorizonResponse('0.12'));

    const price = await priceOracleService.getXlmUsdPrice();

    expect(price).toBeCloseTo(0.12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getXlmUsdPrice returns cached price within TTL (no additional fetch)', async () => {
    fetchMock.mockResolvedValueOnce(makeHorizonResponse('0.12'));

    await priceOracleService.getXlmUsdPrice(); // populates cache
    const price = await priceOracleService.getXlmUsdPrice(); // should use cache

    expect(price).toBeCloseTo(0.12);
    // Only one network call total
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getXlmUsdPrice refetches after cache reset', async () => {
    fetchMock.mockResolvedValue(makeHorizonResponse('0.15'));

    await priceOracleService.getXlmUsdPrice();
    priceOracleService.__resetCacheForTests();
    await priceOracleService.getXlmUsdPrice();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('usdToXlm converts USD to XLM string with 7 decimal places', async () => {
    fetchMock.mockResolvedValueOnce(makeHorizonResponse('0.10'));

    const xlm = await priceOracleService.usdToXlm(10);

    // $10 / $0.10 per XLM = 100 XLM
    expect(xlm).toBe('100.0000000');
  });

  it('xlmToUsd converts XLM to USD float', async () => {
    fetchMock.mockResolvedValueOnce(makeHorizonResponse('0.10'));

    const usd = await priceOracleService.xlmToUsd(50);

    // 50 XLM × $0.10 = $5.00
    expect(usd).toBeCloseTo(5.0);
  });

  it('fetchXlmUsdPrice throws when Horizon response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(priceOracleService.fetchXlmUsdPrice()).rejects.toThrow(
      'Horizon order book request failed: 503',
    );
  });

  it('fetchXlmUsdPrice throws when order book has no bids', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ bids: [] }),
    });

    await expect(priceOracleService.fetchXlmUsdPrice()).rejects.toThrow(
      'No bids available in XLM/USDC order book',
    );
  });
});
