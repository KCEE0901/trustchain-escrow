/**
 * Integration test — DisputeForm happy-path and key interaction flows
 *
 * Covers the full user journey through the dispute submission form:
 *  - Renders without crashing
 *  - Selecting a dispute reason
 *  - Filling in a description
 *  - Submitting the form (happy path — server returns 200)
 *  - Validation errors when required fields are missing
 *  - Cancel button calls onCancel
 *  - Shows terms diff when both originalTerms and proposedTerms are provided
 *
 * Closes #96
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ToastProvider } from '../../contexts/ToastContext';
import DisputeForm from '../../components/dispute/DisputeForm';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../components/ui/FileDropZone', () =>
  function FileDropZone({ onFilesAccepted }) {
    return (
      <button
        type="button"
        data-testid="file-drop-zone"
        onClick={() =>
          onFilesAccepted([new File(['content'], 'evidence.pdf', { type: 'application/pdf' })])
        }
      >
        Drop files here
      </button>
    );
  },
);

jest.mock('../../components/dispute/TermsDiff', () =>
  function TermsDiff({ before, after }) {
    return (
      <div data-testid="terms-diff">
        {before} → {after}
      </div>
    );
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderForm(props = {}) {
  return render(
    <ToastProvider>
      <DisputeForm escrowId="escrow-123" {...props} />
    </ToastProvider>,
  );
}

function pickReason(label) {
  fireEvent.click(screen.getByText(label));
}

function fillDescription(text) {
  fireEvent.change(screen.getByRole('textbox', { name: /description/i }), {
    target: { value: text },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DisputeForm integration', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  it('renders the form with all dispute reason options', () => {
    renderForm();
    expect(screen.getByRole('form', { name: /submit a dispute/i })).toBeInTheDocument();
    expect(screen.getByText('Work not delivered')).toBeInTheDocument();
    expect(screen.getByText('Quality below agreed standard')).toBeInTheDocument();
    expect(screen.getByText('Scope / requirements dispute')).toBeInTheDocument();
    expect(screen.getByText('Payment or milestone dispute')).toBeInTheDocument();
    expect(screen.getByText('Communication breakdown')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows the warning banner about pausing fund release', () => {
    renderForm();
    expect(screen.getByRole('note')).toHaveTextContent(/pause fund release/i);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('shows validation errors when submitting with empty fields', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    await waitFor(() => {
      expect(screen.getByText(/please select a reason/i)).toBeInTheDocument();
      expect(screen.getByText(/please describe the issue/i)).toBeInTheDocument();
    });
  });

  it('shows a validation error when description is too short', async () => {
    renderForm();
    pickReason('Work not delivered');
    fillDescription('Too short');
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    await waitFor(() => {
      expect(screen.getByText(/min 20 characters/i)).toBeInTheDocument();
    });
  });

  it('clears the reason error once a reason is selected', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    await waitFor(() => screen.getByText(/please select a reason/i));
    pickReason('Other');
    await waitFor(() => {
      expect(screen.queryByText(/please select a reason/i)).not.toBeInTheDocument();
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('submits the form successfully and calls onSuccess', async () => {
    const onSuccess = jest.fn();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ disputeId: 'disp-42' }),
    });

    renderForm({ onSuccess });
    pickReason('Work not delivered');
    fillDescription('The contractor did not deliver the agreed milestone within the deadline.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ disputeId: 'disp-42' });
    });
  });

  it('sends escrowId, reason, and description in the request body', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ disputeId: 'disp-1' }),
    });

    renderForm();
    pickReason('Quality below agreed standard');
    fillDescription('The deliverable quality is significantly below the agreed specification.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/disputes/);
    expect(options.method).toBe('POST');

    const body = options.body;
    expect(body instanceof FormData).toBe(true);
    expect(body.get('escrowId')).toBe('escrow-123');
    expect(body.get('reason')).toBe('quality_issue');
    expect(body.get('description')).toMatch(/quality/i);
  });

  it('shows a loading spinner while submitting', async () => {
    let resolveRequest;
    global.fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = () =>
          resolve({ ok: true, json: () => Promise.resolve({ disputeId: 'd1' }) });
      }),
    );

    renderForm();
    pickReason('Other');
    fillDescription('Detailed description of the dispute that exceeds twenty characters.');

    fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submitting/i })).toBeInTheDocument();
    });

    await act(async () => resolveRequest());
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('shows a toast on server error', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    });

    renderForm();
    pickReason('Payment or milestone dispute');
    fillDescription('Payment for milestone 3 has not been released despite approval.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/internal server error/i)).toBeInTheDocument();
    });
  });

  it('shows a toast when fetch throws a network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network failure'));

    renderForm();
    pickReason('Communication breakdown');
    fillDescription('All communication channels have been blocked by the other party.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /submit dispute/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = jest.fn();
    renderForm({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render a cancel button when onCancel is not provided', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  // ── Terms diff ──────────────────────────────────────────────────────────────

  it('renders the TermsDiff when both originalTerms and proposedTerms are supplied', () => {
    renderForm({ originalTerms: 'Original terms', proposedTerms: 'Amended terms' });
    expect(screen.getByTestId('terms-diff')).toBeInTheDocument();
  });

  it('does not render TermsDiff when terms props are omitted', () => {
    renderForm();
    expect(screen.queryByTestId('terms-diff')).not.toBeInTheDocument();
  });

  // ── Character counter ───────────────────────────────────────────────────────

  it('updates the character counter as the user types', () => {
    renderForm();
    fillDescription('Hello world');
    expect(screen.getByText('11/2000')).toBeInTheDocument();
  });
});
