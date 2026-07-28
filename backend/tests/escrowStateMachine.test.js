import { describe, expect, it } from '@jest/globals';
import { assertEscrowTransition, ESCROW_TRANSITIONS } from '../services/escrowService.js';

describe('escrow state machine', () => {
  it('allows configured non-terminal transitions', () => {
    expect(() => assertEscrowTransition('Active', 'Disputed')).not.toThrow();
    expect(() => assertEscrowTransition('Active', 'Completed')).not.toThrow();
    expect(() => assertEscrowTransition('Disputed', 'Cancelled')).not.toThrow();
  });

  it('rejects terminal state transitions', () => {
    expect(() => assertEscrowTransition('Completed', 'Active')).toThrow(
      'Invalid escrow transition from Completed to Active',
    );
    expect(() => assertEscrowTransition('Cancelled', 'Disputed')).toThrow(
      'Invalid escrow transition from Cancelled to Disputed',
    );
  });

  it('keeps terminal states immutable', () => {
    expect(ESCROW_TRANSITIONS.Completed.size).toBe(0);
    expect(ESCROW_TRANSITIONS.Cancelled.size).toBe(0);
  });
});
