import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExpiredEscrowActions, { canRunExpiredEscrowAction } from '../../components/escrow/ExpiredEscrowActions';

test('gates expired actions by authoritative role and status', () => {
  expect(canRunExpiredEscrowAction({ role: 'client', status: 'Expired', pending: false })).toBe(true);
  expect(canRunExpiredEscrowAction({ role: 'observer', status: 'Expired', pending: false })).toBe(false);
  render(<ExpiredEscrowActions role="observer" status="Expired" initialState={{}} onRecover={() => {}} />);
  expect(screen.getByRole('button', { name: 'Recover funds' })).toBeDisabled();
});

test('announces keyboard-triggered recovery and rolls back failures', async () => {
  render(<ExpiredEscrowActions role="client" status="Expired" initialState={{ recovered: false }} onRecover={async () => { throw new Error('failed'); }} />);
  const button = screen.getByRole('button', { name: 'Recover funds' }); button.focus(); fireEvent.keyDown(button, { key: 'Enter' }); fireEvent.click(button);
  expect(screen.getByText('Recovery in progress')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('Escrow expired')).toBeInTheDocument());
});
