import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaleIndexerWarning from '@/components/explorer/StaleIndexerWarning';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStatus(lastLedger, currentLedger) {
  return { lastLedger, currentLedger };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StaleIndexerWarning', () => {
  it('renders nothing when status is null (loading)', () => {
    const { container } = render(<StaleIndexerWarning status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when lag is below the threshold', () => {
    const { container } = render(
      <StaleIndexerWarning status={makeStatus(1000, 1049)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when lag equals zero', () => {
    const { container } = render(
      <StaleIndexerWarning status={makeStatus(1000, 1000)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner when lag equals the threshold (boundary: exactly 50)', () => {
    render(<StaleIndexerWarning status={makeStatus(1000, 1050)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the banner when lag exceeds the threshold', () => {
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('displays the last processed ledger number', () => {
    render(<StaleIndexerWarning status={makeStatus(54321, 54500)} />);
    expect(screen.getByText(/54,321/)).toBeInTheDocument();
  });

  it('displays the lag count', () => {
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);
    // lag = 100
    expect(screen.getByRole('alert')).toHaveTextContent('100');
  });

  it('respects a custom lagThreshold prop', () => {
    // With threshold=200 and lag=100, should NOT show.
    const { container } = render(
      <StaleIndexerWarning status={makeStatus(900, 1000)} lagThreshold={200} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the banner when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls the optional onDismiss callback', async () => {
    const onDismiss = jest.fn();
    const user = userEvent.setup();
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('re-shows the banner if lag worsens after dismissal', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Lag worsens: now 200 ledgers behind (was 100).
    rerender(<StaleIndexerWarning status={makeStatus(800, 1000)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stays hidden if lag is the same after dismissal', async () => {
    const user = userEvent.setup();
    const status = makeStatus(900, 1000);
    const { rerender } = render(<StaleIndexerWarning status={status} />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    // Same lag — should stay dismissed.
    rerender(<StaleIndexerWarning status={status} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has role="alert" for immediate assistive-technology announcement', () => {
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('dismiss button has an accessible label', () => {
    render(<StaleIndexerWarning status={makeStatus(900, 1000)} />);
    expect(
      screen.getByRole('button', { name: /dismiss stale indexer warning/i }),
    ).toBeInTheDocument();
  });
});
