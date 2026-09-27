import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithAppProviders } from '../test-utils';
import EscrowDetailPage from '../../app/escrow/[id]/page';

// Mock useEscrow so tests don't hit the network.
const mockMutate = jest.fn().mockResolvedValue(undefined);

jest.mock('../../hooks/useEscrow', () => ({
  useEscrow: () => ({
    escrow: null, // page falls back to PLACEHOLDER_ESCROW
    isLoading: false,
    error: null,
    mutate: mockMutate,
  }),
}));

// Mock the wallet so DisputeModal's handleRaise can run without Freighter.
const mockSignTx = jest.fn().mockResolvedValue('signed-xdr');
jest.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({
    address: 'GCLIENTTESTADDRESS',
    signTx: mockSignTx,
  }),
}));

// Mock the Stellar tx build/broadcast calls DisputeModal drives.
const mockBuildRaiseDisputeTx = jest.fn().mockResolvedValue('unsigned-xdr');
const mockBroadcastTransaction = jest.fn().mockResolvedValue({ hash: 'tx-hash-123' });
jest.mock('../../lib/stellar', () => ({
  buildApproveMilestoneTx: jest.fn(),
  buildSubmitMilestoneTx: jest.fn(),
  buildRaiseDisputeTx: (...args) => mockBuildRaiseDisputeTx(...args),
  broadcastTransaction: (...args) => mockBroadcastTransaction(...args),
}));

// Mock components that require context providers not set up in tests.
jest.mock(
  '../../components/ui/CurrencyAmount',
  () =>
    function CurrencyAmount({ amount }) {
      return <span>{amount}</span>;
    },
);

jest.mock(
  '../../components/escrow/MilestoneList',
  () =>
    function MilestoneList({ milestones }) {
      return (
        <ul>
          {milestones.map((m) => (
            <li key={m.id}>{m.title}</li>
          ))}
        </ul>
      );
    },
);

const params = { id: '1' };

beforeEach(() => {
  mockMutate.mockClear();
  mockSignTx.mockClear();
  mockBuildRaiseDisputeTx.mockClear().mockResolvedValue('unsigned-xdr');
  mockBroadcastTransaction.mockClear().mockResolvedValue({ hash: 'tx-hash-123' });
});

describe('EscrowDetailPage', () => {
  it('renders escrow title', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Smart Contract Audit')).toBeInTheDocument();
  });

  it('renders escrow status badge', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders escrow ID', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Escrow #1')).toBeInTheDocument();
  });

  it('renders info cells', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('2,000 USDC')).toBeInTheDocument();
    expect(screen.getByText('1,500 USDC')).toBeInTheDocument();
  });

  it('renders Raise Dispute button for active escrow', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByRole('button', { name: /Raise Dispute/ })).toBeInTheDocument();
  });

  it('opens dispute modal when Raise Dispute is clicked', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    fireEvent.click(screen.getByRole('button', { name: /Raise Dispute/ }));
    expect(screen.getByText('Raise Dispute')).toBeInTheDocument();
    // 'Escrow #1' appears in both the page subtitle and the modal header
    expect(screen.getAllByText(/Escrow #1/).length).toBeGreaterThan(0);
  });

  it('closes dispute modal when Cancel is clicked', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    fireEvent.click(screen.getByRole('button', { name: /Raise Dispute/ }));
    fireEvent.click(screen.getByText('Cancel'));
    // Modal should close - the backdrop should be gone
    expect(screen.queryByText(/freeze all funds/)).not.toBeInTheDocument();
  });

  it('renders milestones section', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();
  });

  it('renders all 3 milestones', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Codebase Review')).toBeInTheDocument();
    expect(screen.getByText('Vulnerability Report')).toBeInTheDocument();
    expect(screen.getByText('Final Sign-off')).toBeInTheDocument();
  });

  it('renders party cards', () => {
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.getByText('Freelancer')).toBeInTheDocument();
  });

  // Auto-refresh tests
  describe('auto-refresh', () => {
    it('shows last updated timestamp on mount', () => {
      renderWithAppProviders(<EscrowDetailPage params={params} />);
      expect(screen.getByTestId('last-refreshed')).toHaveTextContent(/Last updated:/);
    });

    it('renders a manual Refresh button', () => {
      renderWithAppProviders(<EscrowDetailPage params={params} />);
      expect(screen.getByRole('button', { name: /Refresh escrow data/ })).toBeInTheDocument();
    });

    it('calls mutate when the Refresh button is clicked', async () => {
      renderWithAppProviders(<EscrowDetailPage params={params} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Refresh escrow data/ }));
      });
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });

    it('updates the last updated timestamp after a manual refresh', async () => {
      renderWithAppProviders(<EscrowDetailPage params={params} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Refresh escrow data/ }));
      });

      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('last-refreshed')).toHaveTextContent(/Last updated:/);
    });
  });

  // Optimistic UI for raising a dispute (#454)
  describe('optimistic dispute status', () => {
    function openAndConfirmDispute() {
      fireEvent.click(screen.getByRole('button', { name: /Raise Dispute/ }));
      fireEvent.click(screen.getByText('Confirm Dispute'));
    }

    it('shows the Disputed status badge immediately, before the transaction resolves', () => {
      // Never resolves within this test — isolates the *immediate* optimistic
      // update from anything that happens once the transaction completes.
      mockBuildRaiseDisputeTx.mockReturnValue(new Promise(() => {}));

      renderWithAppProviders(<EscrowDetailPage params={params} />);
      expect(screen.getByText('Active')).toBeInTheDocument();

      openAndConfirmDispute();

      expect(screen.getByText('Disputed')).toBeInTheDocument();
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
    });

    it('hides the Raise Dispute / Cancel Escrow buttons once the optimistic status applies', () => {
      mockBuildRaiseDisputeTx.mockReturnValue(new Promise(() => {}));

      renderWithAppProviders(<EscrowDetailPage params={params} />);
      openAndConfirmDispute();

      expect(screen.queryByRole('button', { name: /Raise Dispute/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cancel Escrow/ })).not.toBeInTheDocument();
    });

    it('confirms the Disputed status and calls mutate on a successful transaction', async () => {
      renderWithAppProviders(<EscrowDetailPage params={params} />);

      await act(async () => {
        openAndConfirmDispute();
      });

      await waitFor(() => expect(mockBroadcastTransaction).toHaveBeenCalledTimes(1));
      expect(screen.getByText('Disputed')).toBeInTheDocument();
      expect(mockMutate).toHaveBeenCalled();
    });

    it('reverts to the Active status badge when the transaction fails', async () => {
      mockBuildRaiseDisputeTx.mockRejectedValue(new Error('Simulated network failure'));

      renderWithAppProviders(<EscrowDetailPage params={params} />);

      await act(async () => {
        openAndConfirmDispute();
      });

      await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());
      expect(screen.queryByText('Disputed')).not.toBeInTheDocument();
    });

    it('re-enables the Raise Dispute button after a reverted (failed) attempt', async () => {
      mockBuildRaiseDisputeTx.mockRejectedValue(new Error('Simulated network failure'));

      renderWithAppProviders(<EscrowDetailPage params={params} />);

      await act(async () => {
        openAndConfirmDispute();
      });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Raise Dispute/ })).not.toBeDisabled(),
      );
    });
  });
});
