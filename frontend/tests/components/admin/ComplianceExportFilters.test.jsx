import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComplianceExportFilters from '@/components/admin/ComplianceExportFilters';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup(props = {}) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  const onEstimate = jest.fn();
  const result = render(
    <ComplianceExportFilters
      onChange={onChange}
      onSubmit={onSubmit}
      onEstimate={onEstimate}
      {...props}
    />,
  );
  return { ...result, onChange, onSubmit, onEstimate };
}

afterEach(() => {
  jest.clearAllMocks();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('ComplianceExportFilters — rendering', () => {
  it('renders the form with an accessible label', () => {
    setup();
    expect(screen.getByRole('form', { name: /compliance export filters/i })).toBeInTheDocument();
  });

  it('renders all three report-type options', () => {
    setup();
    expect(screen.getByRole('radio', { name: /transactions/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /activity/i })).toBeInTheDocument();
  });

  it('renders from/to date fields', () => {
    setup();
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it('renders the status dropdown', () => {
    setup();
    expect(screen.getByRole('combobox', { name: /status filter/i })).toBeInTheDocument();
  });

  it('renders the tenant input', () => {
    setup();
    expect(screen.getByLabelText(/tenant/i)).toBeInTheDocument();
  });

  it('renders all three export format options', () => {
    setup();
    expect(screen.getByRole('radio', { name: /^json$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^csv$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^pdf$/i })).toBeInTheDocument();
  });

  it('renders the Export submit button when onSubmit is provided', () => {
    setup();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('does NOT render the Export button when onSubmit is omitted', () => {
    render(<ComplianceExportFilters />);
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('pre-selects "transactions" and "csv" by default', () => {
    setup();
    expect(screen.getByRole('radio', { name: /transactions/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^csv$/i })).toBeChecked();
  });

  it('respects initialFilters to pre-seed the form', () => {
    setup({ initialFilters: { reportType: 'users', format: 'pdf' } });
    expect(screen.getByRole('radio', { name: /users/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^pdf$/i })).toBeChecked();
  });
});

// ── Interaction ───────────────────────────────────────────────────────────────

describe('ComplianceExportFilters — interaction', () => {
  it('calls onChange and onEstimate when a valid report type is selected', async () => {
    const user = userEvent.setup();
    const { onChange, onEstimate } = setup();

    await user.click(screen.getByRole('radio', { name: /users/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'users' }));
    expect(onEstimate).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'users' }));
  });

  it('calls onChange when the export format is changed', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(screen.getByRole('radio', { name: /^pdf$/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ format: 'pdf' }));
  });

  it('resets status when report type changes', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ initialFilters: { reportType: 'transactions', status: 'Completed' } });

    await user.click(screen.getByRole('radio', { name: /users/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: 'users', status: '' }),
    );
  });

  it('calls onSubmit with filters when the Export button is clicked with valid data', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: 'transactions', format: 'csv' }),
    );
  });

  it('updates tenant field', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    const tenantInput = screen.getByLabelText(/tenant/i);
    await user.type(tenantInput, 'acme-corp');

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenant: 'acme-corp' }),
    );
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('ComplianceExportFilters — validation', () => {
  it('shows an error when "from" is later than "to"', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/from date/i), '2026-06-01');
    await user.type(screen.getByLabelText(/to date/i), '2026-01-01');

    // Trigger submit to force all touched
    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(
      await screen.findByText(/"from" date must not be later than "to" date/i),
    ).toBeInTheDocument();
  });

  it('does NOT call onSubmit when "from" > "to"', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText(/from date/i), '2026-12-01');
    await user.type(screen.getByLabelText(/to date/i), '2026-01-01');
    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows no error for a valid date range', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText(/from date/i), '2026-01-01');
    await user.type(screen.getByLabelText(/to date/i), '2026-03-31');
    await user.click(screen.getByRole('button', { name: /export/i }));

    expect(screen.queryByText(/"from" date must not be later than "to" date/i)).not.toBeInTheDocument();
  });

  it('does not show errors before the user interacts with the form', () => {
    setup();
    // No touched state — errors should be invisible
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables all inputs when the disabled prop is true', () => {
    setup({ disabled: true });
    const radios = screen.getAllByRole('radio');
    radios.forEach((r) => expect(r).toBeDisabled());
    expect(screen.getByLabelText(/from date/i)).toBeDisabled();
    expect(screen.getByLabelText(/to date/i)).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /status filter/i })).toBeDisabled();
    expect(screen.getByLabelText(/tenant/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });
});

// ── Estimated size display ────────────────────────────────────────────────────

describe('ComplianceExportFilters — estimated size', () => {
  it('shows a loading indicator while estimation is in progress', () => {
    setup({ estimatedSize: { loading: true } });
    expect(screen.getByText(/estimating result size/i)).toBeInTheDocument();
  });

  it('shows the total estimate and per-source counts', () => {
    setup({
      estimatedSize: {
        loading: false,
        totalEstimate: 250,
        counts: { payments: 100, escrows: 50, ledgerEvents: 100 },
      },
    });
    expect(screen.getByText(/250/)).toBeInTheDocument();
    expect(screen.getByText(/estimated rows/i)).toBeInTheDocument();
    expect(screen.getByText(/payments: 100/i)).toBeInTheDocument();
    expect(screen.getByText(/escrows: 50/i)).toBeInTheDocument();
  });

  it('shows a large-dataset warning above 5 000 rows', () => {
    setup({
      estimatedSize: {
        loading: false,
        totalEstimate: 6000,
        counts: { payments: 6000 },
      },
    });
    expect(screen.getByText(/large result set/i)).toBeInTheDocument();
  });

  it('does NOT show the large-dataset warning below the threshold', () => {
    setup({
      estimatedSize: {
        loading: false,
        totalEstimate: 100,
        counts: { payments: 100 },
      },
    });
    expect(screen.queryByText(/large result set/i)).not.toBeInTheDocument();
  });

  it('shows an error message when estimation failed', () => {
    setup({
      estimatedSize: {
        loading: false,
        error: 'DB timeout',
      },
    });
    expect(screen.getByText(/could not estimate size/i)).toBeInTheDocument();
    expect(screen.getByText(/DB timeout/i)).toBeInTheDocument();
  });

  it('renders nothing for estimated size when prop is not provided', () => {
    setup();
    expect(screen.queryByText(/estimated rows/i)).not.toBeInTheDocument();
  });
});
