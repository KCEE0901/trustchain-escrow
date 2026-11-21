/**
 * Structured telemetry for event worker failure alerting (#521): every alert
 * attempt is counted by outcome under bounded labels and logged as one line
 * correlated by `alertKey`, never carrying error text, stacks or payloads.
 */
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    on() {
      return this;
    }
  },
}));
jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  connection: { info: async () => '', quit: async () => undefined },
  stellarEventsQueue: {},
  deadLetterQueue: { add: jest.fn() },
  queueMetrics: { totalJobs: 0 },
}));
jest.unstable_mockModule('../services/alertService.js', () => ({
  sendAlert: jest.fn(),
  ALERT_SEVERITY: { CRITICAL: 'critical' },
  ALERT_TYPES: { PERMANENT_EVENT_FAILURE: 'permanent_event_failure' },
}));

const {
  FAILURE_ALERT_OUTCOMES,
  MAX_TELEMETRY_EVENT_TYPES,
  configureFailureAlerting,
  createMemoryAlertDedupeStore,
  failureAlertKey,
  getFailureAlertMetrics,
  recordFailureAlertTelemetry,
  resetFailureAlertMetrics,
  sendPermanentFailureAlert,
} = await import('../services/eventWorker.js');

const SECRET = ['sk', 'live', 'telemetry'].join('_');
const EVENT_DATA = { event: { topic: ['6573635f63616e'], value: { token: SECRET } }, ledger: 4242 };
const ALERT_KEY = failureAlertKey(EVENT_DATA);
const failure = (overrides = {}) => ({
  alertKey: ALERT_KEY,
  originalJob: EVENT_DATA,
  error: { message: `handler leaked ${SECRET}`, stack: `Error\n    at ${SECRET}.js:1` },
  attemptsMade: 5,
  ...overrides,
});

const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

/** Parsed `[AlertTelemetry]` log lines, in order. */
const telemetryLines = () =>
  logSpy.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.startsWith('[AlertTelemetry] '))
    .map((line) => JSON.parse(line.slice('[AlertTelemetry] '.length)));

const zeroOutcomes = () => Object.fromEntries(FAILURE_ALERT_OUTCOMES.map((o) => [o, 0]));

let sender;

beforeEach(() => {
  jest.clearAllMocks();
  resetFailureAlertMetrics();
  sender = jest.fn(async () => {});
  configureFailureAlerting({ store: createMemoryAlertDedupeStore(), sender });
});

afterAll(() => {
  configureFailureAlerting();
  resetFailureAlertMetrics();
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('failure alert telemetry', () => {
  it('counts and logs a delivered alert, correlated by alert key', async () => {
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');

    expect(telemetryLines()).toEqual([
      {
        type: 'event_failure_alert',
        alertKey: ALERT_KEY,
        outcome: 'sent',
        eventType: 'EscrowCancelled',
        attemptsMade: 5,
        ledger: 4242,
        dedupe: 'ok',
      },
    ]);
    expect(getFailureAlertMetrics()).toEqual({
      outcomes: { ...zeroOutcomes(), sent: 1 },
      dedupeUnavailable: 0,
      byEventType: { EscrowCancelled: { ...zeroOutcomes(), sent: 1 } },
    });
  });

  it('records a suppressed repeat as a duplicate', async () => {
    await sendPermanentFailureAlert(failure());
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('duplicate');

    expect(telemetryLines().map((l) => l.outcome)).toEqual(['sent', 'duplicate']);
    expect(getFailureAlertMetrics().outcomes).toEqual({ ...zeroOutcomes(), sent: 1, duplicate: 1 });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('records a delivery failure, then the successful retry', async () => {
    sender.mockRejectedValueOnce(new Error(`smtp auth ${SECRET}`));

    await expect(sendPermanentFailureAlert(failure())).rejects.toThrow();
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');

    expect(telemetryLines().map((l) => l.outcome)).toEqual(['delivery_failed', 'sent']);
    expect(getFailureAlertMetrics().outcomes).toEqual({
      ...zeroOutcomes(),
      delivery_failed: 1,
      sent: 1,
    });
  });

  it('flags alerts sent while the dedupe store is unavailable', async () => {
    const brokenStore = {
      claim: jest.fn(async () => {
        throw new Error(`redis://user:${SECRET}@cache:6379 refused`);
      }),
      release: jest.fn(async () => {}),
      markSent: jest.fn(async () => {}),
    };
    configureFailureAlerting({ store: brokenStore, sender });

    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');

    expect(telemetryLines()).toEqual([
      expect.objectContaining({ outcome: 'sent', dedupe: 'unavailable' }),
    ]);
    expect(getFailureAlertMetrics().dedupeUnavailable).toBe(1);
  });

  it('never logs error text, stacks or event payloads', async () => {
    sender.mockRejectedValueOnce(new Error(`smtp auth ${SECRET}`));
    await sendPermanentFailureAlert(failure()).catch(() => {});
    await sendPermanentFailureAlert(failure());
    await sendPermanentFailureAlert(failure());

    const output = JSON.stringify(telemetryLines());
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain('handler leaked');
    expect(JSON.stringify(getFailureAlertMetrics())).not.toContain(SECRET);
  });

  it('labels malformed events and missing fields deterministically', async () => {
    await sendPermanentFailureAlert({ alertKey: 'k1', originalJob: { event: {} }, error: null });

    expect(telemetryLines()).toEqual([
      {
        type: 'event_failure_alert',
        alertKey: 'k1',
        outcome: 'sent',
        eventType: 'Unknown',
        attemptsMade: null,
        ledger: null,
        dedupe: 'ok',
      },
    ]);
  });
});

describe('telemetry bounds', () => {
  it('folds event types beyond the cap into `other`', () => {
    for (let i = 0; i < MAX_TELEMETRY_EVENT_TYPES + 5; i++) {
      recordFailureAlertTelemetry({ alertKey: `k${i}`, outcome: 'sent', eventType: `Type${i}` });
    }
    // A type seen before the cap keeps its own label.
    recordFailureAlertTelemetry({ alertKey: 'again', outcome: 'duplicate', eventType: 'Type0' });

    const { byEventType, outcomes } = getFailureAlertMetrics();
    expect(Object.keys(byEventType)).toHaveLength(MAX_TELEMETRY_EVENT_TYPES + 1);
    expect(byEventType.other.sent).toBe(5);
    expect(byEventType.Type0).toEqual({ ...zeroOutcomes(), sent: 1, duplicate: 1 });
    expect(outcomes.sent).toBe(MAX_TELEMETRY_EVENT_TYPES + 5);
  });

  it('rejects unknown outcomes and sanitizes unsafe labels', () => {
    expect(() => recordFailureAlertTelemetry({ alertKey: 'k', outcome: 'exploded' })).toThrow(
      'unknown failure alert outcome',
    );
    const entry = recordFailureAlertTelemetry({
      alertKey: 'k',
      outcome: 'sent',
      eventType: `bad label ${SECRET}\n`,
      attemptsMade: '5',
      ledger: 1.5,
    });
    expect(entry).toMatchObject({ eventType: 'Unknown', attemptsMade: null, ledger: null });
    expect(getFailureAlertMetrics().outcomes.sent).toBe(1);
  });

  it('resets counters', () => {
    recordFailureAlertTelemetry({ alertKey: 'k', outcome: 'sent', eventType: 'EscrowCreated' });
    resetFailureAlertMetrics();
    expect(getFailureAlertMetrics()).toEqual({
      outcomes: zeroOutcomes(),
      dedupeUnavailable: 0,
      byEventType: {},
    });
  });
});
