'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Custom Hook: useLiveXlmRate
 *
 * Fetches and manages live XLM rate data.
 * Provides empty state handling (Issue #243) and accessible interactive controls (Issue #242).
 */
export function useLiveXlmRate(initialCurrency = 'USD') {
  const [rates, setRates] = useState([]);
  const [currency, setCurrency] = useState(initialCurrency);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Best-effort fetch from public Horizon API or fallback rate data
      const res = await fetch(
        'https://horizon-testnet.stellar.org/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=GBBD47IF6LWK2P7MDEVSCWR7DPCCM3M3PPV7GQ2W2W42T75FHV62W5IL&limit=1',
      );
      if (!res.ok) throw new Error('Failed to fetch XLM orderbook');
      const data = await res.json();
      if (data.bids && data.bids.length > 0) {
        const price = parseFloat(data.bids[0].price);
        setRates([
          { pair: 'XLM/USD', rate: price, updatedAt: new Date().toISOString() },
          { pair: 'XLM/USDC', rate: price, updatedAt: new Date().toISOString() },
        ]);
      } else {
        setRates([]);
      }
    } catch (err) {
      setError(err.message || 'Unable to load XLM rate');
      setRates([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  const currentRate = rates.find((r) => r.pair.includes(currency)) || rates[0] || null;

  return {
    rates,
    currentRate,
    currency,
    setCurrency,
    isLoading,
    error,
    refresh: fetchRates,
  };
}

/**
 * Component: LiveXlmRateWidget
 * Renders live XLM rate widget with empty state UI and aria-labels for accessibility.
 */
export function LiveXlmRateWidget({ rates = [], isLoading = false, error = null, onRefresh, onCurrencyChange, currency = 'USD' }) {
  if (isLoading) {
    return (
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-between text-sm text-gray-400">
        <span>Loading XLM rate...</span>
        <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (rates.length === 0 || error) {
    return (
      <div
        role="region"
        aria-label="XLM Live Rate Widget"
        className="p-6 rounded-xl bg-gray-900 border border-gray-800 text-center space-y-3"
      >
        <div className="w-10 h-10 mx-auto rounded-full bg-gray-800 flex items-center justify-center text-gray-400">
          💸
        </div>
        <h4 className="text-sm font-semibold text-white">No XLM exchange rates available</h4>
        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          {error || 'Unable to retrieve live market exchange rates at this moment. Click refresh to try again.'}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh XLM exchange rate"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 border border-indigo-800/50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          🔄 Refresh Rates
        </button>
      </div>
    );
  }

  const activeRate = rates.find((r) => r.pair.includes(currency)) || rates[0];

  return (
    <div
      role="region"
      aria-label="XLM Live Rate Widget"
      className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-between"
    >
      <div className="space-y-0.5">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Live Rate</span>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-white">${activeRate.rate.toFixed(4)}</span>
          <span className="text-xs text-gray-500 font-mono">{activeRate.pair}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={currency}
          onChange={(e) => onCurrencyChange?.(e.target.value)}
          aria-label="Select target exchange currency"
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="USD">USD</option>
          <option value="USDC">USDC</option>
        </select>

        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh XLM exchange rate"
          className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          🔄
        </button>
      </div>
    </div>
  );
}

export default useLiveXlmRate;
