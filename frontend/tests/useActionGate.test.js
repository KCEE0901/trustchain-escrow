/**
 * Unit tests for permission-aware action gating (#540) and
 * privacy-safe interaction telemetry (#542).
 *
 * These tests exercise the pure helpers used by the design-token
 * consistency UI so that gating and telemetry behavior is deterministic
 * and free of secrets.
 */

const {
  evaluateActionGate,
  GATE_VISIBILITY,
} = require('../lib/actionGate');

const {
  emitTelemetry,
  sanitizeTelemetryPayload,
  TELEMETRY_EVENTS,
} = require('../lib/telemetry');

describe('evaluateActionGate (#540)', () => {
  const baseContext = {
    requiredRole: 'admin',
    allowedStatuses: ['active', 'pending'],
  };

  it('enables the action for an authorized role with an allowed escrow status', () => {
    const result = evaluateActionGate({
      ...baseContext,
      role: 'admin',
      escrowStatus: 'active',
    });

    expect(result.visibility).toBe(GATE_VISIBILITY.ENABLED);
    expect(result.enabled).toBe(true);
    expect(result.hidden).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('hides the action for an unauthorized role', () => {
    const result = evaluateActionGate({
      ...baseContext,
      role: 'viewer',
      escrowStatus: 'active',
    });

    expect(result.visibility).toBe(GATE_VISIBILITY.HIDDEN);
    expect(result.enabled).toBe(false);
    expect(result.hidden).toBe(true);
    expect(result.reason).toBe('unauthorized_role');
  });

  it('disables the action for an invalid escrow state', () => {
    const result = evaluateActionGate({
      ...baseContext,
      role: 'admin',
      escrowStatus: 'disputed',
    });

    expect(result.visibility).toBe(GATE_VISIBILITY.DISABLED);
    expect(result.enabled).toBe(false);
    expect(result.hidden).toBe(false);
    expect(result.reason).toBe('invalid_escrow_state');
  });

  it('treats a missing role as unauthorized (boundary path)', () => {
    const result = evaluateActionGate({
      ...baseContext,
      role: undefined,
      escrowStatus: 'active',
    });

    expect(result.visibility).toBe(GATE_VISIBILITY.HIDDEN);
    expect(result.reason).toBe('unauthorized_role');
  });

  it('treats a missing escrow status as invalid (boundary path)', () => {
    const result = evaluateActionGate({
      ...baseContext,
      role: 'admin',
      escrowStatus: undefined,
    });

    expect(result.visibility).toBe(GATE_VISIBILITY.DISABLED);
    expect(result.reason).toBe('invalid_escrow_state');
  });

  it('does not leak wallet addresses in the gate result', () => {
    const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const result = evaluateActionGate({
      ...baseContext,
      role: 'admin',
      escrowStatus: 'active',
      walletAddress,
    });

    expect(JSON.stringify(result)).not.toContain(walletAddress);
  });
});

describe('emitTelemetry (#542)', () => {
  const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const signature = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const token = 'super-secret-token-value';

  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('emits a success event with sanitized metadata', () => {
    const sink = jest.fn();

    const event = emitTelemetry(
      TELEMETRY_EVENTS.ACTION_GATE_EVALUATED,
      {
        outcome: 'success',
        visibility: 'enabled',
        reason: null,
      },
      { sink },
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(event).not.toBeNull();
    expect(event.event).toBe(TELEMETRY_EVENTS.ACTION_GATE_EVALUATED);
    expect(event.outcome).toBe('success');
    expect(event.visibility).toBe('enabled');
    expect(typeof event.timestamp).toBe('string');
  });

  it('strips wallet addresses, signatures, and tokens from the payload', () => {
    const sink = jest.fn();

    const event = emitTelemetry(
      TELEMETRY_EVENTS.ACTION_GATE_EVALUATED,
      {
        outcome: 'success',
        walletAddress,
        signature,
        token,
        nested: {
          wallet: walletAddress,
          signature,
          token,
        },
      },
      { sink },
    );

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(walletAddress);
    expect(serialized).not.toContain(signature);
    expect(serialized).not.toContain(token);
    expect(event.walletAddress).toBeUndefined();
    expect(event.signature).toBeUndefined();
    expect(event.token).toBeUndefined();
    expect(event.nested).toBeUndefined();
  });

  it('sanitizes payloads deterministically', () => {
    const payload = {
      outcome: 'success',
      walletAddress,
      signature,
      token,
      visibility: 'enabled',
    };

    const first = sanitizeTelemetryPayload(payload);
    const second = sanitizeTelemetryPayload(payload);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(walletAddress);
    expect(JSON.stringify(first)).not.toContain(signature);
    expect(JSON.stringify(first)).not.toContain(token);
  });

  it('does not throw on malformed input and returns a safe no-op event', () => {
    const sink = jest.fn();

    expect(() =>
      emitTelemetry(TELEMETRY_EVENTS.ACTION_GATE_EVALUATED, null, { sink }),
    ).not.toThrow();

    const event = emitTelemetry(
      TELEMETRY_EVENTS.ACTION_GATE_EVALUATED,
      undefined,
      { sink },
    );

    expect(event).not.toBeNull();
    expect(event.outcome).toBe('noop');
  });

  it('does not throw when running server-side without a window', () => {
    const originalWindow = global.window;
    // eslint-disable-next-line no-undefined
    global.window = undefined;

    try {
      expect(() =>
        emitTelemetry(TELEMETRY_EVENTS.ACTION_GATE_EVALUATED, {
          outcome: 'success',
        }),
      ).not.toThrow();
    } finally {
      global.window = originalWindow;
    }
  });

  it('never records wallet addresses in emitted events', () => {
    const sink = jest.fn();

    emitTelemetry(
      TELEMETRY_EVENTS.ACTION_GATE_EVALUATED,
      {
        outcome: 'success',
        visibility: 'enabled',
        walletAddress,
      },
      { sink },
    );

    const [emitted] = sink.mock.calls[0];
    expect(JSON.stringify(emitted)).not.toContain(walletAddress);
  });
});