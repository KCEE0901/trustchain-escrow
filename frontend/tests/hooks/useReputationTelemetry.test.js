import { renderHook } from '@testing-library/react';
import {
  REPUTATION_TELEMETRY_EVENT,
  buildReputationTelemetry,
  classifyReputationError,
  reportReputationTelemetry,
  setReputationTelemetryReporter,
  useReputation,
} from '../../hooks/useReputation';

// Built at runtime so no wallet-like literal lives in the repo.
const ADDRESS = `G${'A'.repeat(55)}`;
const OTHER_ADDRESS = `G${'B'.repeat(55)}`;

function expectNoSensitiveData(event, ...secrets) {
  const serialized = JSON.stringify(event);
  for (const secret of secrets) {
    expect(serialized).not.toContain(String(secret));
  }
  expect(Object.keys(event).sort()).toEqual(['badge', 'errorCode', 'event', 'hasData', 'outcome']);
}

afterEach(() => {
  setReputationTelemetryReporter(null);
});

describe('buildReputationTelemetry', () => {
  it('reports success with only the badge tier', () => {
    const reputation = {
      address: ADDRESS,
      total_score: 620,
      wallet: ADDRESS,
      completed_escrows: 9,
    };
    const event = buildReputationTelemetry({ address: ADDRESS, reputation });

    expect(event).toEqual({
      event: REPUTATION_TELEMETRY_EVENT,
      outcome: 'success',
      badge: 'EXPERT',
      errorCode: null,
      hasData: true,
    });
    expectNoSensitiveData(event, ADDRESS, 620);
  });

  it('reports errors as a fixed code without the message', () => {
    const error = new Error(`lookup failed for ${ADDRESS}`);
    error.status = 404;
    const event = buildReputationTelemetry({ address: ADDRESS, error });

    expect(event.outcome).toBe('error');
    expect(event.errorCode).toBe('http_4xx');
    expectNoSensitiveData(event, ADDRESS, 'lookup failed');
  });

  it('skips when there is no address and waits while loading', () => {
    expect(buildReputationTelemetry({ address: null }).outcome).toBe('skipped');
    expect(buildReputationTelemetry({}).outcome).toBe('skipped');
    expect(buildReputationTelemetry({ address: ADDRESS, isLoading: true }).outcome).toBe('loading');
  });

  it('treats a missing or malformed score as the NEW tier', () => {
    expect(buildReputationTelemetry({ address: ADDRESS, reputation: null })).toMatchObject({
      outcome: 'success',
      badge: 'NEW',
      hasData: false,
    });
    expect(
      buildReputationTelemetry({ address: ADDRESS, reputation: { total_score: 'x' } }).badge,
    ).toBe('NEW');
  });

  it('is deterministic for the same input', () => {
    const input = { address: ADDRESS, reputation: { total_score: 1200 } };
    expect(buildReputationTelemetry(input)).toEqual(buildReputationTelemetry(input));
  });
});

describe('classifyReputationError', () => {
  it.each([
    [{ status: 429 }, 'http_4xx'],
    [{ response: { status: 503 } }, 'http_5xx'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
    [new TypeError('Failed to fetch'), 'network'],
    [new Error('useReputation not implemented'), 'not_implemented'],
    [new Error(`bad ${ADDRESS}`), 'unknown'],
    ['boom', 'unknown'],
    [null, 'unknown'],
  ])('classifies %p as %s', (error, code) => {
    expect(classifyReputationError(error)).toBe(code);
  });
});

describe('useReputation telemetry', () => {
  it('reports one privacy-safe event per address', () => {
    const reporter = jest.fn();
    setReputationTelemetryReporter(reporter);

    const { rerender } = renderHook(({ address }) => useReputation(address), {
      initialProps: { address: ADDRESS },
    });
    expect(reporter).toHaveBeenCalledTimes(1);
    const [event] = reporter.mock.calls[0];
    expect(event).toEqual({
      event: REPUTATION_TELEMETRY_EVENT,
      outcome: 'error',
      badge: 'NEW',
      errorCode: 'not_implemented',
      hasData: false,
    });
    expectNoSensitiveData(event, ADDRESS);

    rerender({ address: ADDRESS });
    expect(reporter).toHaveBeenCalledTimes(1);

    rerender({ address: OTHER_ADDRESS });
    expect(reporter).toHaveBeenCalledTimes(2);
    expectNoSensitiveData(reporter.mock.calls[1][0], ADDRESS, OTHER_ADDRESS);
  });

  it('does not report when no address is given', () => {
    const reporter = jest.fn();
    setReputationTelemetryReporter(reporter);

    renderHook(() => useReputation(null));
    expect(reporter).not.toHaveBeenCalled();
  });

  it('keeps the hook result unchanged when the reporter throws', () => {
    setReputationTelemetryReporter(() => {
      throw new Error('sink down');
    });

    const { result } = renderHook(() => useReputation(ADDRESS));
    expect(result.current.reputation).toBeNull();
    expect(result.current.badge).toBe('NEW');
    expect(result.current.error.message).toMatch(/not implemented/i);
  });

  it('sends nothing without a reporter', () => {
    expect(reportReputationTelemetry({ event: REPUTATION_TELEMETRY_EVENT })).toBe(false);
    setReputationTelemetryReporter('not a function');
    expect(reportReputationTelemetry({ event: REPUTATION_TELEMETRY_EVENT })).toBe(false);
  });
});
