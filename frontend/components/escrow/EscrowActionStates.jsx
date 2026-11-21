export function PaymentTokenAvailability({ state, symbol, onRetry }) {
  if (state === 'loading') return <p role="status" aria-live="polite">Checking payment token…</p>;
  if (state === 'error') return <div role="alert">Payment token availability could not be checked. <button type="button" onClick={onRetry}>Retry</button></div>;
  if (state === 'empty') return <p role="status">No payment token is available.</p>;
  return <p role="status" aria-label="Payment token available">{symbol} is available</p>;
}

export function ExpiredEscrowActionState({ state, onRetry }) {
  if (state === 'loading') return <p role="status" aria-live="polite">Checking escrow actions…</p>;
  if (state === 'error') return <div role="alert">Actions could not be loaded. <button type="button" onClick={onRetry}>Retry</button></div>;
  if (state === 'empty') return <p role="status">No actions are available for this expired escrow.</p>;
  return null;
}
