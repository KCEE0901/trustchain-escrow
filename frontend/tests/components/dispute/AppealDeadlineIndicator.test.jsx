import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppealDeadlineIndicator from '@/components/dispute/AppealDeadlineIndicator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function futureDeadline(ms = 60_000) {
  return new Date(Date.now() + ms).toISOString();
}

function pastDeadline() {
  return new Date(Date.now() - 1000).toISOString();
}

function mockFetchOk() {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  );
}

function mockFetchStatus(status, message = 'Window closed') {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ message }),
    }),
  );
}

function mockFetchNetworkError() {
  global.fetch = jest.fn(() => Promise.reject(new Error('Network failure')));
}

afterEach(() => jest.restoreAllMocks());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppealDeadlineIndicator', () => {
  it('renders the deadline date in a <time> element', () => {
    const deadline = futureDeadline();
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={deadline} appealWindowOpen />,
    );
    const time = document.querySelector('time');
    expect(time).toBeInTheDocument();
    expect(time).toHaveAttribute('dateTime', new Date(deadline).toISOString());
  });

  it('shows the Submit Appeal button when window is open', () => {
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={futureDeadline()} appealWindowOpen />,
    );
    expect(screen.getByRole('button', { name: /submit appeal/i })).toBeInTheDocument();
  });

  it('disables the button when appealWindowOpen is false', () => {
    render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={futureDeadline()}
        appealWindowOpen={false}
      />,
    );
    expect(screen.getByRole('button', { name: /submit appeal/i })).toBeDisabled();
  });

  it('disables the button when the client-side deadline has passed', async () => {
    render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={pastDeadline()}
        appealWindowOpen
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /submit appeal/i })).toBeDisabled(),
    );
  });

  it('shows the countdown timer while the window is open', () => {
    render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={futureDeadline(3_600_000)} // 1 hour
        appealWindowOpen
      />,
    );
    // The h (hours) unit label should be visible.
    expect(screen.getByText('h')).toBeInTheDocument();
  });

  it('posts to the correct endpoint on appeal submit', async () => {
    mockFetchOk();
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator disputeId="99" deadline={futureDeadline()} appealWindowOpen />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));

    await waitFor(() => {
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toContain('/api/disputes/99/appeal');
      expect(opts.method).toBe('POST');
    });
  });

  it('shows success state after a successful appeal submission', async () => {
    mockFetchOk();
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={futureDeadline()} appealWindowOpen />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));

    expect(await screen.findByText(/appeal submitted successfully/i)).toBeInTheDocument();
  });

  it('calls onAppealSubmitted callback on success', async () => {
    mockFetchOk();
    const cb = jest.fn();
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={futureDeadline()}
        appealWindowOpen
        onAppealSubmitted={cb}
      />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));
    await waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  });

  it('handles 409 by closing the window and showing the server message', async () => {
    mockFetchStatus(409, 'Appeal window has closed.');
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={futureDeadline()} appealWindowOpen />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Appeal window has closed.');
    expect(screen.getByRole('button', { name: /submit appeal/i })).toBeDisabled();
  });

  it('handles 422 by closing the window and showing the server message', async () => {
    mockFetchStatus(422, 'Invalid appeal state.');
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={futureDeadline()} appealWindowOpen />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid appeal state.');
    expect(screen.getByRole('button', { name: /submit appeal/i })).toBeDisabled();
  });

  it('shows a generic error for network failures without closing the window', async () => {
    mockFetchNetworkError();
    const user = userEvent.setup();
    render(
      <AppealDeadlineIndicator disputeId="1" deadline={futureDeadline()} appealWindowOpen />,
    );
    await user.click(screen.getByRole('button', { name: /submit appeal/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network failure/i);
    // Button should still be enabled — the window is still open.
    expect(screen.getByRole('button', { name: /submit appeal/i })).not.toBeDisabled();
  });

  it('syncs with the appealWindowOpen prop change from parent', () => {
    const { rerender } = render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={futureDeadline()}
        appealWindowOpen
      />,
    );
    expect(screen.getByRole('button', { name: /submit appeal/i })).not.toBeDisabled();

    rerender(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={futureDeadline()}
        appealWindowOpen={false}
      />,
    );
    expect(screen.getByRole('button', { name: /submit appeal/i })).toBeDisabled();
  });

  it('shows "deadline has passed" when the client-side timer reaches zero', async () => {
    render(
      <AppealDeadlineIndicator
        disputeId="1"
        deadline={pastDeadline()}
        appealWindowOpen
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/deadline has passed/i)).toBeInTheDocument(),
    );
  });
});
