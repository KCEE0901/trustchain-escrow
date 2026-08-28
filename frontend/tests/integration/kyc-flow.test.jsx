import { fireEvent, screen, waitFor } from '@testing-library/react';
import KycPage from '../../app/kyc/page';
import { renderWithAppProviders } from '../test-utils';

jest.mock('@sumsub/websdk-react', () => {
  return function MockSumsubWebSdk({ accessToken, onMessage }) {
    return (
      <div data-testid="sumsub-sdk" data-token={accessToken}>
        <button type="button" onClick={() => onMessage?.('idCheck.onApplicantSubmitted')}>
          Submit applicant
        </button>
      </div>
    );
  };
});

const CONNECTED_WALLET = {
  address: 'GTESTKYC1234567890',
  isConnected: true,
};

describe('KycPage integration flow', () => {
  beforeEach(() => {
    global.fetch = jest.fn((url, options) => {
      if (url.includes('/api/kyc/status/GTESTKYC1234567890')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'Pending' }),
        });
      }

      if (url.includes('/api/kyc/token') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ token: 'sumsub-test-token' }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('walks through status fetch, token start, and applicant submission', async () => {
    renderWithAppProviders(<KycPage />, { wallet: CONNECTED_WALLET });

    expect(await screen.findByRole('button', { name: /Start Verification/i })).toBeInTheDocument();
    expect(screen.getByText(/Verification Status/i)).toBeInTheDocument();
    expect(screen.getByText(/Start verification to unlock full platform access/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start Verification/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/kyc/token'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    expect(
      await screen.findByText(/Verification started\. Complete the steps below\./i),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('sumsub-sdk')).toHaveAttribute(
      'data-token',
      'sumsub-test-token',
    );

    fireEvent.click(await screen.findByRole('button', { name: /Submit applicant/i }));

    await waitFor(() =>
      expect(screen.getByText(/Your documents are being reviewed/i)).toBeInTheDocument(),
    );
  });
});
