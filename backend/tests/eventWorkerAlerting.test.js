/**
 * Event worker failure alerting idempotency (#522): a permanently failed
 * event yields one dead-letter job and one alert, even when `failed` fires
 * again, the dead-letter job is retried, or workers race on the same failure.
 */
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const deadLetterJobs = new Map();
const deadLetterQueue = {
  // Emulates BullMQ: adding a job whose custom jobId already exists is a no-op.
  add: jest.fn(async (name, data, opts = {}) => {
    const id = opts.jobId ?? `auto-${deadLetterJobs.size + 1}`;
    if (!deadLetterJobs.has(id)) deadLetterJobs.set(id, { id, name, data });
    return deadLetterJobs.get(id);
  }),
};
const sendAlert = jest.fn();

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    constructor() {
      this.handlers = {};
    }
    on(event, fn) {
      this.handlers[event] = fn;
      return this;
    }
  },
}));
jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  connection: { info: async () => '', quit: async () => undefined },
  stellarEventsQueue: {},
  deadLetterQueue,
  queueMetrics: { totalJobs: 0 },
}));
jest.unstable_mockModule('../services/alertService.js', () => ({
  sendAlert,
  ALERT_SEVERITY: { CRITICAL: 'critical' },
  ALERT_TYPES: { PERMANENT_EVENT_FAILURE: 'permanent_event_failure' },
}));

const {
  FAILURE_ALERT_LEASE_MS,
  configureFailureAlerting,
  createEventWorker,
  createMemoryAlertDedupeStore,
  createRedisAlertDedupeStore,
  deadLetterJobId,
  failureAlertKey,
  handleEventJobFailed,
  processDeadLetterEvent,
  sendPermanentFailureAlert,
} = await import('../services/eventWorker.js');

const EVENT_DATA = { event: { topic: ['6573635f63616e'], value: { id: 7 } }, ledger: 4242 };

function failedJob(overrides = {}) {
  return { id: 'job-1', data: EVENT_DATA, attemptsMade: 5, opts: { attempts: 5 }, ...overrides };
}

function dlqJob(data = EVENT_DATA) {
  return {
    data: {
      originalJob: data,
      error: { message: 'handler blew up', stack: 'Error: handler blew up\n    at secretPath.js:1' },
      attemptsMade: 5,
    },
  };
}

const consoleSpies = ['log', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
const loggedOutput = () => JSON.stringify(consoleSpies.map((s) => s.mock.calls));

let sender;

beforeEach(() => {
  deadLetterJobs.clear();
  jest.clearAllMocks();
  sender = jest.fn(async () => {});
  configureFailureAlerting({ store: createMemoryAlertDedupeStore(), sender });
});

afterAll(() => {
  configureFailureAlerting();
  consoleSpies.forEach((s) => s.mockRestore());
});

describe('failure keys', () => {
  it('are deterministic, independent of key order, and safe as BullMQ job ids', () => {
    const reordered = { ledger: 4242, event: { value: { id: 7 }, topic: ['6573635f63616e'] } };
    expect(failureAlertKey(reordered)).toBe(failureAlertKey(EVENT_DATA));
    expect(failureAlertKey({ ...EVENT_DATA, ledger: 4243 })).not.toBe(failureAlertKey(EVENT_DATA));
    expect(failureAlertKey(EVENT_DATA)).toMatch(/^[0-9a-f]{32}$/);
    expect(deadLetterJobId(failureAlertKey(EVENT_DATA))).not.toContain(':');
  });
});

describe('moving failed jobs to the dead letter queue', () => {
  it('enqueues one dead-letter job per failure even if `failed` fires repeatedly', async () => {
    await handleEventJobFailed(failedJob(), new Error('boom'));
    await handleEventJobFailed(failedJob(), new Error('boom'));
    // The same event re-enqueued under a new job id is the same failure.
    await handleEventJobFailed(failedJob({ id: 'job-2' }), new Error('boom'));

    const key = failureAlertKey(EVENT_DATA);
    expect(deadLetterQueue.add).toHaveBeenCalledTimes(3);
    for (const call of deadLetterQueue.add.mock.calls) {
      expect(call[2]).toEqual({ jobId: deadLetterJobId(key) });
    }
    expect(deadLetterJobs.size).toBe(1);
    expect([...deadLetterJobs.values()][0].data).toMatchObject({
      originalJob: EVENT_DATA,
      attemptsMade: 5,
      originalJobId: 'job-1',
      alertKey: key,
    });
  });

  it('is wired to the worker `failed` event', async () => {
    const worker = createEventWorker();
    worker.handlers.failed(failedJob(), new Error('boom'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(deadLetterJobs.size).toBe(1);
  });

  it('does nothing before the final attempt or without a job', async () => {
    await handleEventJobFailed(failedJob({ attemptsMade: 2 }), new Error('retrying'));
    await expect(handleEventJobFailed(undefined, new Error('stalled'))).resolves.toBeUndefined();
    expect(deadLetterQueue.add).not.toHaveBeenCalled();
  });

  it('never rejects (no unhandled rejection) when the dead letter queue is down', async () => {
    deadLetterQueue.add.mockRejectedValueOnce(new Error('redis down\n    at internal/stack.js:9'));
    await expect(handleEventJobFailed(failedJob(), new Error('boom'))).resolves.toBeUndefined();
    expect(loggedOutput()).not.toContain('internal/stack.js');
  });
});

describe('sending the permanent failure alert', () => {
  const failure = () => ({
    alertKey: failureAlertKey(EVENT_DATA),
    originalJob: EVENT_DATA,
    error: { message: 'handler blew up', stack: 'Error: handler blew up\n    at secretPath.js:1' },
    attemptsMade: 5,
  });

  it('sends once with a deterministic, secret-free payload', async () => {
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith({
      alertKey: failureAlertKey(EVENT_DATA),
      ledger: 4242,
      eventType: 'EscrowCancelled',
      attemptsMade: 5,
      error: 'handler blew up',
    });
    expect(JSON.stringify(sender.mock.calls)).not.toContain('secretPath');
  });

  it('suppresses a retry of the same failure', async () => {
    await sendPermanentFailureAlert(failure());
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('duplicate');
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('sends once when two workers race on the same failure', async () => {
    let finish;
    sender.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    const first = sendPermanentFailureAlert(failure());
    const second = sendPermanentFailureAlert(failure());
    await expect(second).resolves.toBe('duplicate');
    finish();
    await expect(first).resolves.toBe('sent');
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when delivery fails so a retry can alert', async () => {
    sender.mockRejectedValueOnce(new Error('webhook 502'));

    await expect(sendPermanentFailureAlert(failure())).rejects.toThrow('webhook 502');
    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('still alerts (fails open) when the dedupe store is unavailable', async () => {
    const broken = {
      claim: jest.fn().mockRejectedValue(new Error('redis down')),
      markSent: jest.fn().mockRejectedValue(new Error('redis down')),
      release: jest.fn(),
    };
    configureFailureAlerting({ store: broken, sender });

    await expect(sendPermanentFailureAlert(failure())).resolves.toBe('sent');
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('truncates long error messages to their first line', async () => {
    const long = `${'x'.repeat(400)}\nsecond line`;
    await sendPermanentFailureAlert({ ...failure(), error: { message: long } });
    const { error } = sender.mock.calls[0][0];
    expect(error.startsWith('x'.repeat(300))).toBe(true);
    expect(error).not.toContain('second line');
    expect(error.length).toBeLessThanOrEqual(301);
  });
});

describe('dead letter processing', () => {
  it('alerts once across dead-letter retries of the same failure', async () => {
    await expect(processDeadLetterEvent(dlqJob())).resolves.toBe('sent');
    await expect(processDeadLetterEvent(dlqJob())).resolves.toBe('duplicate');
    expect(sender).toHaveBeenCalledTimes(1);
    expect(loggedOutput()).not.toContain('secretPath');
  });

  it('alerts separately for different failures', async () => {
    await processDeadLetterEvent(dlqJob());
    await processDeadLetterEvent(dlqJob({ ...EVENT_DATA, ledger: 9999 }));
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('routes through alertService with a per-failure cooldown key by default', async () => {
    configureFailureAlerting({ store: createMemoryAlertDedupeStore() });
    sendAlert.mockResolvedValueOnce('sent').mockResolvedValueOnce('failed');

    await processDeadLetterEvent(dlqJob());
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'permanent_event_failure',
        severity: 'critical',
        dedupeKey: `permanent_event_failure:${failureAlertKey(EVENT_DATA)}`,
      }),
    );

    // A delivery failure reported by alertService surfaces as an error so
    // BullMQ can retry the dead-letter job.
    await expect(processDeadLetterEvent(dlqJob({ ...EVENT_DATA, ledger: 1 }))).rejects.toThrow(
      'alert delivery failed',
    );
  });
});

describe('dedupe stores', () => {
  it('memory store: an abandoned claim can be retaken after the lease expires', async () => {
    let now = 1_000;
    const store = createMemoryAlertDedupeStore(() => now);

    expect(await store.claim('k', 'worker-a', FAILURE_ALERT_LEASE_MS)).toBe(true);
    expect(await store.claim('k', 'worker-b', FAILURE_ALERT_LEASE_MS)).toBe(false);
    // Only the owner can release its claim.
    await store.release('k', 'worker-b');
    expect(await store.claim('k', 'worker-b', FAILURE_ALERT_LEASE_MS)).toBe(false);

    now += FAILURE_ALERT_LEASE_MS + 1;
    expect(await store.claim('k', 'worker-b', FAILURE_ALERT_LEASE_MS)).toBe(true);
  });

  it('redis store: claims atomically with NX and releases only its own token', async () => {
    const redis = { set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null), eval: jest.fn() };
    const store = createRedisAlertDedupeStore(redis);

    expect(await store.claim('abc', 't1', 60_000)).toBe(true);
    expect(await store.claim('abc', 't2', 60_000)).toBe(false);
    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      'trustchain:alerts:event-failure:abc',
      'pending:t1',
      'PX',
      60_000,
      'NX',
    );

    await store.release('abc', 't1');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
      1,
      'trustchain:alerts:event-failure:abc',
      'pending:t1',
    );
  });
});
