import { jest } from '@jest/globals';

const prismaMock = { contractEvent: { findFirst: jest.fn() } };
const queueMetrics = {
  getFailureRate: jest.fn(() => 0),
  getSuccessRate: jest.fn(() => 100),
  deadLetterCount: 0,
  failedJobs: 0,
  totalJobs: 0,
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../lib/queueConfig.js', () => ({ queueMetrics }));

const { calculateSyncLag, monitorQueueHealth } = await import('../services/alertService.js');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

describe('alertService sync lag', () => {
  let nowSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.contractEvent.findFirst = jest.fn();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('calculates milliseconds since the newest indexed ledger event', async () => {
    prismaMock.contractEvent.findFirst.mockResolvedValue({ ledgerAt: new Date(1_699_999_970_000) });

    await expect(calculateSyncLag()).resolves.toBe(30_000);
    expect(prismaMock.contractEvent.findFirst).toHaveBeenCalledWith({
      orderBy: { ledgerAt: 'desc' },
      select: { ledgerAt: true },
    });
  });

  it('returns zero when there are no indexed events', async () => {
    prismaMock.contractEvent.findFirst.mockResolvedValue(null);

    await expect(calculateSyncLag()).resolves.toBe(0);
  });

  it('returns zero for invalid or future ledger timestamps', async () => {
    prismaMock.contractEvent.findFirst.mockResolvedValue({ ledgerAt: 'not-a-date' });
    await expect(calculateSyncLag()).resolves.toBe(0);

    prismaMock.contractEvent.findFirst.mockResolvedValue({ ledgerAt: new Date(1_700_000_000_001) });
    await expect(calculateSyncLag()).resolves.toBe(0);
  });

  it('shares one indexed-event read across overlapping requests', async () => {
    const read = deferred();
    prismaMock.contractEvent.findFirst.mockReturnValue(read.promise);

    const first = calculateSyncLag();
    const second = calculateSyncLag();
    await flushAsyncWork();
    expect(prismaMock.contractEvent.findFirst).toHaveBeenCalledTimes(1);

    read.resolve({ ledgerAt: new Date(1_699_999_990_000) });
    await expect(Promise.all([first, second])).resolves.toEqual([10_000, 10_000]);
  });

  it('does not emit duplicate sync-lag alerts for overlapping health checks', async () => {
    const read = deferred();
    prismaMock.contractEvent.findFirst.mockReturnValue(read.promise);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const first = monitorQueueHealth();
    const second = monitorQueueHealth();
    await flushAsyncWork();
    read.resolve({ ledgerAt: new Date(1_699_999_900_000) });
    await Promise.all([first, second]);

    expect(
      logSpy.mock.calls.filter(([message]) => String(message).includes('SYNC_LAG_HIGH')),
    ).toHaveLength(1);
    logSpy.mockRestore();
  });

  it('returns a stable zero when the optional model or database query is unavailable', async () => {
    prismaMock.contractEvent.findFirst = undefined;
    await expect(calculateSyncLag()).resolves.toBe(0);

    prismaMock.contractEvent.findFirst = jest
      .fn()
      .mockRejectedValue(new Error('database unavailable'));
    await expect(calculateSyncLag()).resolves.toBe(0);
  });

  it('shares a failing query and allows a later request to retry', async () => {
    const read = deferred();
    prismaMock.contractEvent.findFirst.mockReturnValue(read.promise);

    const first = calculateSyncLag();
    const second = calculateSyncLag();
    await flushAsyncWork();
    read.reject(new Error('database unavailable'));
    await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);

    prismaMock.contractEvent.findFirst.mockResolvedValue({ ledgerAt: new Date(1_699_999_995_000) });
    await expect(calculateSyncLag()).resolves.toBe(5_000);
  });
});
