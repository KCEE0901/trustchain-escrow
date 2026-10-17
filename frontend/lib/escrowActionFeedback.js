const ALLOWED_OUTCOMES = new Set(['shown', 'blocked', 'confirmed', 'failed']);

export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  return Boolean(matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function escrowActionMotionClass(matchMedia) {
  return prefersReducedMotion(matchMedia) ? 'transition-none' : 'transition-opacity duration-200';
}

export function createEscrowActionTelemetry(action, outcome) {
  if (!ALLOWED_OUTCOMES.has(outcome)) throw new TypeError('unsupported escrow action outcome');
  return { event: 'expired_escrow_action', action, outcome };
}
