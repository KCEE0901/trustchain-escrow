import { fireEvent, render, screen } from '@testing-library/react';
import { ExpiredEscrowActionState, PaymentTokenAvailability } from '../../components/escrow/EscrowActionStates';

test('announces payment token states and supports keyboard retry', () => {
  const retry = jest.fn(); render(<PaymentTokenAvailability state="error" onRetry={retry} />);
  const button = screen.getByRole('button', { name: 'Retry' }); button.focus(); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  expect(screen.getByRole('alert')).toBeInTheDocument(); expect(retry).toHaveBeenCalled();
});

test.each(['loading', 'empty', 'error'])('renders expired escrow %s state', (state) => {
  render(<ExpiredEscrowActionState state={state} onRetry={() => {}} />);
  expect(screen.getByRole(state === 'error' ? 'alert' : 'status')).toBeInTheDocument();
});
