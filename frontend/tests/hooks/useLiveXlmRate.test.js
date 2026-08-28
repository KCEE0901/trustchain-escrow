import { render, screen, fireEvent } from '@testing-library/react';
import { LiveXlmRateWidget } from '../../hooks/useLiveXlmRate';

describe('LiveXlmRateWidget Empty State & Accessibility', () => {
  it('renders a friendly empty state when rates list is empty', () => {
    render(<LiveXlmRateWidget rates={[]} />);

    expect(screen.getByText('No XLM exchange rates available')).toBeInTheDocument();
    expect(
      screen.getByText(/Unable to retrieve live market exchange rates/),
    ).toBeInTheDocument();
  });

  it('includes aria-label on refresh button in empty state', () => {
    const onRefresh = jest.fn();
    render(<LiveXlmRateWidget rates={[]} onRefresh={onRefresh} />);

    const refreshBtn = screen.getByRole('button', { name: 'Refresh XLM exchange rate' });
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveAttribute('aria-label', 'Refresh XLM exchange rate');

    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('includes aria-label attributes on interactive controls when rates exist', () => {
    const mockRates = [{ pair: 'XLM/USD', rate: 0.1234, updatedAt: new Date().toISOString() }];
    const onRefresh = jest.fn();
    const onCurrencyChange = jest.fn();

    render(
      <LiveXlmRateWidget
        rates={mockRates}
        onRefresh={onRefresh}
        onCurrencyChange={onCurrencyChange}
      />,
    );

    const refreshBtn = screen.getByRole('button', { name: 'Refresh XLM exchange rate' });
    const select = screen.getByRole('combobox', { name: 'Select target exchange currency' });

    expect(refreshBtn).toBeInTheDocument();
    expect(select).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'USDC' } });
    expect(onCurrencyChange).toHaveBeenCalledWith('USDC');
  });
});
