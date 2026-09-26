import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeadLetterQueue from '@/components/admin/DeadLetterQueue';

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

const MOCK_JOB = {
  id: 'dlq-001',
  type: 'webhook.deliver',
  failureReason: 'ECONNREFUSED after 5 retries',
  attemptsMade: 5,
  timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
  payload: { webhookId: 'wh_abc', event: 'escrow.completed' },
  acknowledged: false,
};

const MOCK_JOB_ACKED = { ...MOCK_JOB, id: 'dlq-ack', acknowledged: true };

function mockFetch(jobs = [MOCK_JOB]) {
  global.fetch = jest.fn((url) => {
    if (url.includes('/dead-letter') && !url.includes('/replay') && !url.includes('/acknowledge')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function mockFetchFail() {
  global.fetch = jest.fn(() => Promise.reject(new Error('network error')));
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DeadLetterQueue', () => {
  it('renders the section heading', async () => {
    mockFetch();
    render(<DeadLetterQueue />);
    expect(await screen.findByRole('heading', { name: /dead-letter queue/i })).toBeInTheDocument();
  });

  it('shows the unacknowledged job count after loading', async () => {
    mockFetch([MOCK_JOB, MOCK_JOB_ACKED]);
    render(<DeadLetterQueue />);
    expect(await screen.findByText(/1 unacknowledged job/i)).toBeInTheDocument();
  });

  it('displays job type badge, failure reason, and attempt count', async () => {
    mockFetch();
    render(<DeadLetterQueue />);
    expect(await screen.findByText('webhook.deliver')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED after 5 retries/i)).toBeInTheDocument();
    expect(screen.getByText(/5 attempts made/i)).toBeInTheDocument();
  });

  it('falls back to mock data when the backend is unreachable', async () => {
    mockFetchFail();
    render(<DeadLetterQueue />);
    // The built-in mock contains "webhook.deliver" — verify fallback rendered it.
    expect(await screen.findByText('webhook.deliver')).toBeInTheDocument();
  });

  it('expands and collapses the payload preview', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    const btn = await screen.findByRole('button', { name: /preview payload/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/wh_abc/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /hide payload/i }));
    expect(screen.queryByText(/wh_abc/)).not.toBeVisible();
  });

  it('removes the job from the list after a successful replay', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');

    await user.click(screen.getByRole('button', { name: /replay job dlq-001/i }));

    await waitFor(() => {
      expect(screen.queryByText('webhook.deliver')).not.toBeInTheDocument();
    });
  });

  it('shows the re-queued toast after replay', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');

    await user.click(screen.getByRole('button', { name: /replay job dlq-001/i }));

    expect(await screen.findByRole('status', { hidden: true })).toHaveTextContent(
      /re-queued for replay/i,
    );
  });

  it('dims an acknowledged job and hides its acknowledge button', async () => {
    mockFetch([MOCK_JOB]);
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');

    await user.click(screen.getByRole('button', { name: /acknowledge job dlq-001/i }));

    await waitFor(() => {
      const row = screen.getByRole('row', { name: /job dlq-001/i });
      expect(row).toHaveClass('opacity-40');
    });
    expect(screen.queryByRole('button', { name: /acknowledge job dlq-001/i })).not.toBeInTheDocument();
  });

  it('shows the acknowledged toast', async () => {
    mockFetch([MOCK_JOB]);
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');

    await user.click(screen.getByRole('button', { name: /acknowledge job dlq-001/i }));

    expect(await screen.findByRole('status', { hidden: true })).toHaveTextContent(/acknowledged/i);
  });

  it('disables the replay button for already-acknowledged jobs', async () => {
    mockFetch([MOCK_JOB_ACKED]);
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');
    expect(screen.getByRole('button', { name: /replay job dlq-ack/i })).toBeDisabled();
  });

  it('shows an empty state when the queue has no jobs', async () => {
    mockFetch([]);
    render(<DeadLetterQueue />);
    expect(await screen.findByText(/dead-letter queue is empty/i)).toBeInTheDocument();
  });

  it('re-fetches the list when Refresh is clicked', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<DeadLetterQueue />);
    await screen.findByText('webhook.deliver');

    const callsBefore = global.fetch.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
