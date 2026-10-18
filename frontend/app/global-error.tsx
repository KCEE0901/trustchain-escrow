'use client';

import { useEffect, useState } from 'react';

type Role = 'admin' | 'operator' | 'viewer';
type EscrowState = 'active' | 'paused' | 'settled' | 'disputed';

type TelemetryEvent =
  | 'error_boundary_view'
  | 'error_boundary_retry'
  | 'error_boundary_retry_blocked'
  | 'error_boundary_report';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function readRole(): Role {
  if (typeof document === 'undefined') return 'viewer';
  const raw = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('role='))
    ?.split('=')[1];
  if (raw === 'admin' || raw === 'operator' || raw === 'viewer') return raw;
  return 'viewer';
}

function readEscrowState(): EscrowState {
  if (typeof document === 'undefined') return 'settled';
  const raw = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('escrow_state='))
    ?.split('=')[1];
  if (raw === 'active' || raw === 'paused' || raw === 'settled' || raw === 'disputed') {
    return raw;
  }
  return 'settled';
}

function canRetry(role: Role, escrowState: EscrowState): boolean {
  if (role === 'viewer') return false;
  return escrowState === 'active' || escrowState === 'paused';
}

function canReport(role: Role): boolean {
  return role === 'admin' || role === 'operator';
}

// Privacy-safe telemetry: only coarse, non-identifying fields are emitted.
// Never include wallet addresses, error messages, or raw payloads.
function emitTelemetry(
  event: TelemetryEvent,
  role: Role,
  escrowState: EscrowState,
  digest: string | null,
): void {
  if (typeof window === 'undefined') return;
  const payload = {
    event,
    role,
    escrowState,
    digest,
  };
  try {
    console.info('[telemetry]', payload);
  } catch {
    // Telemetry must never break the error boundary.
  }
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const [role, setRole] = useState<Role>('viewer');
  const [escrowState, setEscrowState] = useState<EscrowState>('settled');

  useEffect(() => {
    setRole(readRole());
    setEscrowState(readEscrowState());
  }, []);

  useEffect(() => {
    console.error('[global-error]', {
      message: error.message,
      digest: error.digest ?? null,
      role,
      escrowState,
    });
  }, [error, role, escrowState]);

  useEffect(() => {
    emitTelemetry('error_boundary_view', role, escrowState, error.digest ?? null);
  }, [role, escrowState, error.digest]);

  const retryAllowed = canRetry(role, escrowState);
  const reportAllowed = canReport(role);

  const handleRetry = () => {
    if (!retryAllowed) {
      emitTelemetry('error_boundary_retry_blocked', role, escrowState, error.digest ?? null);
      return;
    }
    emitTelemetry('error_boundary_retry', role, escrowState, error.digest ?? null);
    reset();
  };

  const handleReport = () => {
    emitTelemetry('error_boundary_report', role, escrowState, error.digest ?? null);
  };

  return (
    <html lang="en">
      <body>
        <main role="alert" aria-live="assertive">
          <h1>Something went wrong</h1>
          <p>
            An unexpected error occurred. You can try again, or contact support if the
            problem persists.
          </p>
          {error.digest ? (
            <p>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={!retryAllowed}
              aria-disabled={!retryAllowed}
              title={
                retryAllowed
                  ? undefined
                  : 'Retry is unavailable for your role or the current escrow state.'
              }
            >
              Try again
            </button>
            {reportAllowed ? (
              <a href="mailto:support@example.com" onClick={handleReport}>
                Report this issue
              </a>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
