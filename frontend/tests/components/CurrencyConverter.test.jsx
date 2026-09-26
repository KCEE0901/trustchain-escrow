import {
  convertCurrencyAmount,
  isSupportedCurrency,
} from '../../components/ui/CurrencyConverter';

describe('CurrencyConverter helpers', () => {
  it('handles zero and very large conversion amounts', () => {
    expect(convertCurrencyAmount('0', 0.12)).toBe(0);
    expect(convertCurrencyAmount('1000000000', 0.5)).toBe(500000000);
  });

  it('rejects unsupported currency codes and invalid prices', () => {
    expect(isSupportedCurrency('DOGE')).toBe(false);
    expect(isSupportedCurrency('XLM')).toBe(true);
    expect(convertCurrencyAmount('10', 0)).toBe('');
  });
});
