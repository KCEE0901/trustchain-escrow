import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlippageControl from '@/components/escrow/SlippageControl';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderSlippage(overrides = {}) {
  const defaults = {
    sendAmount: 100,
    exchangeRate: 1.5,
    value: 0.5,
    onChange: jest.fn(),
    disabled: false,
  };
  return render(<SlippageControl {...defaults} {...overrides} />);
}

// ─── Preset buttons ───────────────────────────────────────────────────────────

describe('SlippageControl — presets', () => {
  it('renders the three preset buttons', () => {
    renderSlippage();
    expect(screen.getByRole('button', { name: '0.1 %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0.5 %' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.0 %' })).toBeInTheDocument();
  });

  it('marks the current value preset as pressed', () => {
    renderSlippage({ value: 0.5 });
    expect(screen.getByRole('button', { name: '0.5 %' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '0.1 %' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the preset value when clicked', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderSlippage({ onChange });

    await user.click(screen.getByRole('button', { name: '0.1 %' }));
    expect(onChange).toHaveBeenCalledWith(0.1);
  });

  it('calls onChange with 1.0 when the 1.0 % preset is clicked', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderSlippage({ onChange });

    await user.click(screen.getByRole('button', { name: '1.0 %' }));
    expect(onChange).toHaveBeenCalledWith(1.0);
  });

  it('disables all preset buttons when disabled prop is true', () => {
    renderSlippage({ disabled: true });
    ['0.1 %', '0.5 %', '1.0 %'].forEach(label => {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    });
  });
});

// ─── Custom input ─────────────────────────────────────────────────────────────

describe('SlippageControl — custom input', () => {
  it('renders the custom input', () => {
    renderSlippage();
    expect(screen.getByRole('textbox', { name: /custom/i })).toBeInTheDocument();
  });

  it('calls onChange with a valid custom value', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    renderSlippage({ onChange });

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, '2');
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('shows a validation error for values below the minimum', async () => {
    const user = userEvent.setup();
    renderSlippage();

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, '0.001');
    expect(screen.getByRole('alert')).toHaveTextContent(/minimum slippage is 0.01/i);
  });

  it('shows a validation error for values above the maximum', async () => {
    const user = userEvent.setup();
    renderSlippage();

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, '51');
    expect(screen.getByRole('alert')).toHaveTextContent(/maximum slippage is 50/i);
  });

  it('shows a validation error for non-numeric input', async () => {
    const user = userEvent.setup();
    renderSlippage();

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, 'abc');
    expect(screen.getByRole('alert')).toHaveTextContent(/valid number/i);
  });

  it('marks the input as aria-invalid when there is a validation error', async () => {
    const user = userEvent.setup();
    renderSlippage();

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, '0.001');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears validation error when input is emptied', async () => {
    const user = userEvent.setup();
    renderSlippage();

    const input = screen.getByRole('textbox', { name: /custom/i });
    await user.clear(input);
    await user.type(input, '0.001');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.clear(input);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ─── Estimated minimum received ───────────────────────────────────────────────

describe('SlippageControl — estimated minimum received', () => {
  it('shows the estimated minimum received when sendAmount and exchangeRate are set', () => {
    // sendAmount=100, rate=1.5, slippage=0.5% → min = 100 * 1.5 * (1 - 0.005) = 149.25
    renderSlippage({ sendAmount: 100, exchangeRate: 1.5, value: 0.5 });
    expect(screen.getByText(/estimated minimum received/i)).toBeInTheDocument();
    expect(screen.getByText(/149\.25/)).toBeInTheDocument();
  });

  it('hides the estimate when sendAmount is 0', () => {
    renderSlippage({ sendAmount: 0 });
    expect(screen.queryByText(/estimated minimum received/i)).not.toBeInTheDocument();
  });

  it('hides the estimate when exchangeRate is 0', () => {
    renderSlippage({ exchangeRate: 0 });
    expect(screen.queryByText(/estimated minimum received/i)).not.toBeInTheDocument();
  });
});

// ─── High-slippage warning ────────────────────────────────────────────────────

describe('SlippageControl — high-slippage warning', () => {
  it('does not show the warning below 3 %', () => {
    renderSlippage({ value: 2.9 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the warning at exactly 3 %', () => {
    renderSlippage({ value: 3 });
    expect(screen.getByRole('alert')).toHaveTextContent(/high slippage/i);
  });

  it('shows the warning above 3 %', () => {
    renderSlippage({ value: 5 });
    expect(screen.getByRole('alert')).toHaveTextContent(/high slippage/i);
  });

  it('includes the current tolerance value in the warning text', () => {
    renderSlippage({ value: 5 });
    expect(screen.getByRole('alert')).toHaveTextContent('5');
  });
});
