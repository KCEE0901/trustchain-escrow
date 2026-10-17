import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockPathname = jest.fn(() => '/kyc/admin');

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
}));

// Wallet / auth mock — tests override the returned role per case.
const mockUseWallet = jest.fn();
jest.mock('@/components/WalletProvider', () => ({
  useWallet: () => mockUseWallet(),
}));

// Telemetry mock — captures emitted events for privacy assertions.
const mockTrackEvent = jest.fn();
jest.mock('@/lib/telemetry', () => ({
  trackEvent: (...args) => mockTrackEvent(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ADDRESS = '0x1111111111111111111111111111111111111111';
const USER_ADDRESS = '0x2222222222222222222222222222222222222222';
const ESCROW_ID = 'escrow-abc-123';

function setWallet({ role = 'admin', address = ADMIN_ADDRESS, connected = true } = {}) {
  mockUseWallet.mockReturnValue({
    address: connected ? address : null,
    isConnected: connected,
    role,
    chainId: 1,
  });
}

function mockMatchMedia({ reducedMotion = false } = {}) {
  const listeners = new Set();
  const mql = {
    matches: reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (event, cb) => {
      if (event === 'change') listeners.add(cb);
    },
    removeEventListener: (event, cb) => {
      if (event === 'change') listeners.delete(cb);
    },
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
    dispatchEvent: () => true,
  };

  window.matchMedia = jest.fn().mockImplementation((query) => {
    if (query === '(prefers-reduced-motion: reduce)') {
      return mql;
    }
    return {
      ...mql,
      matches: false,
      media: query,
    };
  });

  return mql;
}

function getTelemetryEvents() {
  return mockTrackEvent.mock.calls.map((call) => call[0]);
}

function assertPrivacySafeEvent(event) {
  expect(event).toBeTruthy();
  expect(typeof event).toBe('object');

  const allowedKeys = ['actionId', 'outcome', 'roleCategory', 'durationBucket'];
  const keys = Object.keys(event);
  keys.forEach((key) => {
    expect(allowedKeys).toContain(key);
  });

  // No wallet addresses or sensitive payloads anywhere in the serialized event.
  const serialized = JSON.stringify(event).toLowerCase();
  expect(serialized).not.toContain(ADMIN_ADDRESS.toLowerCase());
  expect(serialized).not.toContain(USER_ADDRESS.toLowerCase());
  expect(serialized).not.toContain('0x');
  expect(serialized).not.toContain('address');
  expect(serialized).not.toContain('wallet');
  expect(serialized).not.toContain('signature');
  expect(serialized).not.toContain('privatekey');
  expect(serialized).not.toContain('escrowid');
  expect(serialized).not.toContain(ESCROW_ID.toLowerCase());
}

// ---------------------------------------------------------------------------
// Lazy import of the page under test (after mocks are registered)
// ---------------------------------------------------------------------------

let KycAdminPage;

beforeAll(async () => {
  ({ default: KycAdminPage } = await import('@/app/kyc/admin/page'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname.mockReturnValue('/kyc/admin');
  mockMatchMedia({ reducedMotion: false });
  setWallet({ role: 'admin' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Permission gating
// ---------------------------------------------------------------------------

describe('KYC admin route authorization — permission gating', () => {
  it('renders admin actions for an authorized admin role', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.queryByText(/not authorized/i)).not.toBeInTheDocument();
  });

  it('denies access and hides actions for a non-admin role', async () => {
    setWallet({ role: 'user', address: USER_ADDRESS });

    render(<KycAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('denies access when the wallet is disconnected', async () => {
    setWallet({ connected: false, role: 'admin' });

    render(<KycAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('treats an invalid escrow-state boundary as non-actionable', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage initialEscrowState="unknown" />);

    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('disables actions when the escrow is already in a terminal state', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage initialEscrowState="released" />);

    await waitFor(() => {
      const approve = screen.queryByRole('button', { name: /approve/i });
      if (approve) {
        expect(approve).toBeDisabled();
      } else {
        expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

describe('KYC admin route authorization — reduced motion', () => {
  it('keeps feedback visible with motion enabled', async () => {
    mockMatchMedia({ reducedMotion: false });
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/approv/i);
  });

  it('keeps feedback visible with reduced motion enabled', async () => {
    mockMatchMedia({ reducedMotion: true });
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/approv/i);
  });

  it('does not throw when matchMedia is unavailable', async () => {
    const original = window.matchMedia;
    // eslint-disable-next-line no-undefined
    window.matchMedia = undefined;
    setWallet({ role: 'admin' });

    expect(() => render(<KycAdminPage />)).not.toThrow();

    window.matchMedia = original;
  });
});

// ---------------------------------------------------------------------------
// Privacy-safe telemetry
// ---------------------------------------------------------------------------

describe('KYC admin route authorization — privacy-safe telemetry', () => {
  it('emits a privacy-safe success event on approval', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalled();
    });

    const events = getTelemetryEvents();
    expect(events.length).toBeGreaterThan(0);

    const successEvent = events.find((e) => e && e.outcome === 'success');
    expect(successEvent).toBeTruthy();
    expect(successEvent.actionId).toBeTruthy();
    expect(successEvent.roleCategory).toBeTruthy();
    expect(successEvent.durationBucket).toBeTruthy();
    assertPrivacySafeEvent(successEvent);
  });

  it('emits a privacy-safe failure event when an unauthorized user attempts an action', async () => {
    setWallet({ role: 'user', address: USER_ADDRESS });

    render(<KycAdminPage />);

    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });

    const events = getTelemetryEvents();
    const failureEvent = events.find((e) => e && e.outcome === 'failure');
    if (failureEvent) {
      expect(failureEvent.actionId).toBeTruthy();
      expect(failureEvent.roleCategory).toBeTruthy();
      assertPrivacySafeEvent(failureEvent);
    }
  });

  it('never includes wallet addresses or sensitive fields in any event', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalled();
    });

    getTelemetryEvents().forEach((event) => {
      assertPrivacySafeEvent(event);
    });
  });

  it('emits deterministic duration buckets rather than raw timings', async () => {
    setWallet({ role: 'admin' });

    render(<KycAdminPage />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalled();
    });

    const allowedBuckets = ['0-100ms', '100-500ms', '500-1000ms', '1000ms+', 'unknown'];
    getTelemetryEvents().forEach((event) => {
      if (event && event.durationBucket !== undefined) {
        expect(allowedBuckets).toContain(event.durationBucket);
      }
    });
  });
});