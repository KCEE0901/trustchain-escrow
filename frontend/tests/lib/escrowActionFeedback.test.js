import { createEscrowActionTelemetry, escrowActionMotionClass } from '../../lib/escrowActionFeedback';

test('uses non-animated feedback when reduced motion is requested', () => {
  expect(escrowActionMotionClass(() => ({ matches: true }))).toBe('transition-none');
  expect(escrowActionMotionClass(() => ({ matches: false }))).toContain('duration-200');
});

test('telemetry contains no wallet address or escrow payload', () => {
  expect(createEscrowActionTelemetry('release', 'blocked')).toEqual({
    event: 'expired_escrow_action', action: 'release', outcome: 'blocked',
  });
  expect(() => createEscrowActionTelemetry('release', 'wallet-address')).toThrow();
});
