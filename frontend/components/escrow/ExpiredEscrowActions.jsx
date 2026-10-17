'use client';

import { useState } from 'react';

export function canRunExpiredEscrowAction({ role, status, pending }) {
  return !pending && status === 'Expired' && ['client', 'admin'].includes(role);
}

export default function ExpiredEscrowActions({ role, status, initialState, onRecover }) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const allowed = canRunExpiredEscrowAction({ role, status, pending });

  async function recover() {
    const snapshot = state;
    setPending(true);
    setState({ ...state, recovered: true });
    try { setState(await onRecover(state)); }
    catch { setState(snapshot); }
    finally { setPending(false); }
  }

  return <section aria-labelledby="expired-actions-title" className="rounded border p-4">
    <h2 id="expired-actions-title">Expired escrow actions</h2>
    <p aria-live="polite">{pending ? 'Recovery in progress' : state?.recovered ? 'Escrow recovered' : 'Escrow expired'}</p>
    <button type="button" disabled={!allowed} aria-disabled={!allowed} onClick={recover}>Recover funds</button>
  </section>;
}
