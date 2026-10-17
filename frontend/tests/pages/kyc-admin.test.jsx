import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import KycAdminPage from '../../app/kyc/admin/page';

const makeRecord = (id) => ({
  id,
  address: `G${id}ADDRESS123456`,
  applicantId: `applicant-${id}`,
  status: 'Approved',
  reviewResult: 'Passed',
  rejectLabels: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const response = (data) => ({
  json: async () => ({ data, total: data.length }),
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('KycAdminPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('renders records returned by the current request', async () => {
    global.fetch.mockResolvedValue(response([makeRecord('current')]));

    render(<KycAdminPage />);

    expect(await screen.findByText('applicant-current')).toBeInTheDocument();
    expect(screen.getByText('1 total records')).toBeInTheDocument();
  });

  it('keeps the newer filter response when an older request resolves later', async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    global.fetch.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);

    render(<KycAdminPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);

    newRequest.resolve(response([makeRecord('newer')]));
    expect(await screen.findByText('applicant-newer')).toBeInTheDocument();
    oldRequest.resolve(response([makeRecord('older')]));

    await waitFor(() => expect(screen.queryByText('applicant-older')).not.toBeInTheDocument());
    expect(screen.getByText('applicant-newer')).toBeInTheDocument();
  });

  it('shows the empty state when the current request returns no records', async () => {
    global.fetch.mockResolvedValue(response([]));

    render(<KycAdminPage />);

    expect(await screen.findByText('No records found.')).toBeInTheDocument();
  });

  it('stops loading without exposing stale data when the current request fails', async () => {
    global.fetch.mockRejectedValue(new Error('request failed'));

    render(<KycAdminPage />);

    expect(await screen.findByText('No records found.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
