import { screen } from '@testing-library/react';
import EscrowDetailPage from '../../app/escrow/[id]/page';
import { useEscrow } from '../../hooks/useEscrow';
import { renderWithAppProviders } from '../test-utils';

jest.mock('../../hooks/useEscrow');
jest.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ address: null, signTx: jest.fn() }),
}));

describe('EscrowDetailPage error states', () => {
  const params = { id: '99' };

  it('shows loading while escrow is fetching', () => {
    useEscrow.mockReturnValue({
      escrow: undefined,
      isLoading: true,
      error: undefined,
      mutate: jest.fn(),
    });
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText(/Loading escrow/i)).toBeInTheDocument();
  });

  it('shows fetch error with retry', () => {
    useEscrow.mockReturnValue({
      escrow: undefined,
      isLoading: false,
      error: new Error('Network error'),
      mutate: jest.fn(),
    });
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText(/Unable to load escrow/i)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows not-found when API returns no escrow', () => {
    useEscrow.mockReturnValue({
      escrow: null,
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText(/Escrow not found/i)).toBeInTheDocument();
  });

  it('renders real escrow data without placeholder', () => {
    useEscrow.mockReturnValue({
      escrow: {
        title: 'Live Escrow',
        status: 'Active',
        clientAddress: 'GCLIENT',
        freelancerAddress: 'GFREELANCER',
        milestones: [],
      },
      isLoading: false,
      error: undefined,
      mutate: jest.fn(),
    });
    renderWithAppProviders(<EscrowDetailPage params={params} />);
    expect(screen.getByText('Live Escrow')).toBeInTheDocument();
    expect(screen.queryByText('Smart Contract Audit')).not.toBeInTheDocument();
  });
});