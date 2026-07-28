import { render, screen } from '@testing-library/react';
import TransactionState from '../../../components/ui/TransactionState';

describe('TransactionState', () => {
  it('renders accessible success state with animation class', () => {
    const { container } = render(
      <TransactionState state="success" message="Payment released." txHash="abc123" />,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Transaction confirmed')).toBeInTheDocument();
    expect(screen.getByText('Payment released.')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(container.querySelector('.animate-tx-success')).toBeInTheDocument();
  });

  it('renders accessible failure state with animation class', () => {
    const { container } = render(<TransactionState state="failure" message="Rejected." />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Transaction failed')).toBeInTheDocument();
    expect(screen.getByText('Rejected.')).toBeInTheDocument();
    expect(container.querySelector('.animate-tx-failure')).toBeInTheDocument();
  });
});
