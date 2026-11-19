import { fireEvent, screen, waitFor } from '@testing-library/react';
import CreateEscrowPage from '../../app/escrow/create/page';
import { renderWithAppProviders } from '../test-utils';
import { useWallet } from '../../hooks/useWallet';
import * as stellar from '../../lib/stellar';

jest.mock('../../hooks/useWallet', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../../lib/stellar', () => {
  const actual = jest.requireActual('../../lib/stellar');
  return {
    ...actual,
    buildCreateEscrowTx: jest.fn(),
    broadcastTransaction: jest.fn(),
  };
});

const VALID_ADDR = 'GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH';

describe('CreateEscrowPage integration flow', () => {
  beforeEach(() => {
    useWallet.mockReturnValue({
      address: VALID_ADDR,
      isConnected: true,
      network: 'testnet',
      connect: jest.fn(),
      signTx: jest.fn().mockResolvedValue('SIGNED_XDR'),
    });
    stellar.buildCreateEscrowTx.mockResolvedValue('UNSIGNED_XDR');
    stellar.broadcastTransaction.mockResolvedValue({ escrowId: '42', hash: 'abc' });
    // jsdom crypto.subtle may be missing — stub a stable hash
    if (!global.crypto?.subtle) {
      global.crypto = {
        subtle: {
          digest: async () => new Uint8Array(32).buffer,
        },
      };
    }
  });

  it('preserves entered counterparty details while moving between steps', async () => {
    renderWithAppProviders(<CreateEscrowPage />);

    fireEvent.change(screen.getByPlaceholderText(/GABCD1234/i), {
      target: { value: 'GTESTFREELANCER123' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '2500' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    expect(screen.getByDisplayValue('GTESTFREELANCER123')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2500')).toBeInTheDocument();
  });

  it('builds, signs, and broadcasts then navigates on success', async () => {
    const { useRouter } = require('next/navigation');
    const push = jest.fn();
    useRouter.mockReturnValue({ push, replace: jest.fn(), prefetch: jest.fn() });

    renderWithAppProviders(<CreateEscrowPage />);

    fireEvent.change(screen.getByPlaceholderText(/GABCD1234/i), {
      target: { value: VALID_ADDR },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '10' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign & Create Escrow/i }));

    await waitFor(() => {
      expect(stellar.buildCreateEscrowTx).toHaveBeenCalled();
      expect(stellar.broadcastTransaction).toHaveBeenCalledWith('SIGNED_XDR');
      expect(push).toHaveBeenCalledWith('/escrow/42');
    });
  });

  it('surfaces wallet rejection without false success', async () => {
    useWallet.mockReturnValue({
      address: VALID_ADDR,
      isConnected: true,
      network: 'testnet',
      connect: jest.fn(),
      signTx: jest.fn().mockRejectedValue(new Error('Transaction signing was cancelled.')),
    });

    renderWithAppProviders(<CreateEscrowPage />);

    fireEvent.change(screen.getByPlaceholderText(/GABCD1234/i), {
      target: { value: VALID_ADDR },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), {
      target: { value: '10' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign & Create Escrow/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cancelled/i);
    });
    expect(stellar.broadcastTransaction).not.toHaveBeenCalled();
  });
});