'use client';

import { useEffect, useState } from 'react';

type Role = 'admin' | 'operator' | 'viewer';
type EscrowState = 'active' | 'paused' | 'settled' | 'disputed';

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

  const retryAllowed = canRetry(role, escrowState);
  const reportAllowed = canReport(role);

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
              onClick={reset}
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
              <a href="mailto:support@example.com">Report this issue</a>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
