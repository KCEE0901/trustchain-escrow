'use client';

import { useEffect, useState } from 'react';

type ErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

type ViewerRole = 'admin' | 'operator' | 'viewer' | 'anonymous';

type EscrowState = 'active' | 'released' | 'disputed' | 'unknown';

type ViewerContext = {
  role: ViewerRole;
  escrowState: EscrowState;
};

const DEFAULT_CONTEXT: ViewerContext = {
  role: 'anonymous',
  escrowState: 'unknown',
};

const KNOWN_ROLES: readonly ViewerRole[] = ['admin', 'operator', 'viewer', 'anonymous'];
const KNOWN_ESCROW_STATES: readonly EscrowState[] = ['active', 'released', 'disputed', 'unknown'];

function normalizeRole(value: string | null | undefined): ViewerRole {
  if (value && (KNOWN_ROLES as readonly string[]).includes(value)) {
    return value as ViewerRole;
  }
  return 'anonymous';
}

function normalizeEscrowState(value: string | null | undefined): EscrowState {
  if (value && (KNOWN_ESCROW_STATES as readonly string[]).includes(value)) {
    return value as EscrowState;
  }
  return 'unknown';
}

function readViewerContext(): ViewerContext {
  if (typeof document === 'undefined') {
    return DEFAULT_CONTEXT;
  }

  const root = document.documentElement;
  return {
    role: normalizeRole(root.dataset.viewerRole),
    escrowState: normalizeEscrowState(root.dataset.escrowState),
  };
}

function canRetry(context: ViewerContext): boolean {
  return context.role !== 'anonymous';
}

function canReport(context: ViewerContext): boolean {
  return context.role === 'admin' || context.role === 'operator';
}

function canContactSupport(context: ViewerContext): boolean {
  return context.escrowState !== 'unknown';
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  const [context, setContext] = useState<ViewerContext>(DEFAULT_CONTEXT);

  useEffect(() => {
    setContext(readViewerContext());
  }, []);

  useEffect(() => {
    // Deterministic, secret-free diagnostic log for production error coverage.
    console.error('[error-boundary]', {
      digest: error.digest ?? 'none',
      role: context.role,
      escrowState: context.escrowState,
    });
  }, [error.digest, context.role, context.escrowState]);

  const retryAllowed = canRetry(context);
  const reportAllowed = canReport(context);
  const supportAllowed = canContactSupport(context);

  return (
    <div role="alert" aria-live="assertive">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred while rendering this page.</p>
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
          title={retryAllowed ? undefined : 'Sign in to retry'}
        >
          Try again
        </button>

        {reportAllowed ? (
          <button type="button" onClick={() => window.location.reload()}>
            Report issue
          </button>
        ) : null}

        {supportAllowed ? (
          <a href="/support">Contact support</a>
        ) : (
          <span aria-disabled="true" title="Escrow state unavailable">
            Contact support
          </span>
        )}
      </div>
    </div>
  );
}
