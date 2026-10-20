/**
 * Sync-lag retention (#498): the sync-lag history is bounded by age and count,
 * cleanup is safe and idempotent, and calculateSyncLag only reports a fresh,
 * valid sample.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  queueMetrics: {
    getFailureRate: () => 0,
    getSuccessRate: () => 100,
    deadLetterCount: 0,
    totalJobs: 0,
    failedJobs: 0,
  },
}));

const {
  ALERT_TYPES,
  SYNC_LAG_RETENTION,
  calculateSyncLag,
  clearSyncLagSamples,
  configureSyncLagRetention,
  getSyncLagRetention,
  getSyncLagSamples,
  monitorQueueHealth,
  pruneSyncLagSamples,
  recordSyncLagSample,
} = await import('../services/alertService.js');

const T0 = 1_700_000_000_000;

function sample(overrides = {}) {
  return {
    latestLedger: 1_000,
    processedLedger: 990,
    latestClosedAt: T0,
    processedClosedAt: T0 - 50_000,
    observedAt: T0,
    ...overrides,
  };
}

beforeEach(() => {
  clearSyncLagSamples();
  configureSyncLagRetention({
    maxSamples: SYNC_LAG_RETENTION.MAX_SAMPLES,
    maxAgeMs: SYNC_LAG_RETENTION.MAX_AGE_MS,
    staleAfterMs: SYNC_LAG_RETENTION.STALE_AFTER_MS,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('calculateSyncLag', () => {
  it('returns 0 when nothing has been recorded (unchanged default)', async () => {
    expect(await calculateSyncLag(T0)).toBe(0);
  });

  it('reports the lag of the newest fresh sample', async () => {
    expect(recordSyncLagSample(sample())).toBe(true);
    expect(
      recordSyncLagSample(sample({ observedAt: T0 + 1_000, processedClosedAt: T0 - 20_000 })),
    ).toBe(true);

    expect(await calculateSyncLag(T0 + 2_000)).toBe(20_000);
  });

  it('ignores a stale sample instead of alerting on old data', async () => {
    recordSyncLagSample(sample());

    expect(await calculateSyncLag(T0 + SYNC_LAG_RETENTION.STALE_AFTER_MS)).toBe(50_000);
    expect(await calculateSyncLag(T0 + SYNC_LAG_RETENTION.STALE_AFTER_MS + 1)).toBe(0);
  });

  it('clamps clock skew to zero lag', async () => {
    recordSyncLagSample(sample({ processedClosedAt: T0 + 5_000 }));
    expect(await calculateSyncLag(T0)).toBe(0);
  });
});

describe('recordSyncLagSample validation', () => {
  it.each([
    ['missing fields', {}],
    ['processed ahead of chain', sample({ processedLedger: 1_001 })],
    ['negative ledger', sample({ latestLedger: -1, processedLedger: -2 })],
    ['fractional ledger', sample({ processedLedger: 1.5 })],
    ['NaN close time', sample({ latestClosedAt: Number.NaN })],
    ['string timestamp', sample({ observedAt: '2026-01-01' })],
  ])('rejects %s and stores nothing', (_, input) => {
    expect(recordSyncLagSample(input)).toBe(false);
    expect(getSyncLagSamples()).toEqual([]);
  });

  it('stores only numeric fields', () => {
    recordSyncLagSample({
      ...sample(),
      rpcUrl: 'https://user:secret@rpc.example',
      payload: { a: 1 },
    });

    expect(getSyncLagSamples()).toEqual([
      {
        latestLedger: 1_000,
        processedLedger: 990,
        ledgersBehind: 10,
        lagMs: 50_000,
        observedAt: T0,
      },
    ]);
    expect(JSON.stringify(getSyncLagSamples())).not.toContain('secret');
  });
});

describe('retention', () => {
  it('caps the history at MAX_SAMPLES, keeping the newest', () => {
    configureSyncLagRetention({ maxSamples: 5 });
    for (let i = 0; i < 12; i += 1) {
      recordSyncLagSample(sample({ observedAt: T0 + i, processedLedger: 990 + (i % 10) }));
    }

    const samples = getSyncLagSamples();
    expect(samples).toHaveLength(5);
    expect(samples.map((s) => s.observedAt)).toEqual([7, 8, 9, 10, 11].map((i) => T0 + i));
  });

  it('drops samples older than MAX_AGE_MS', () => {
    configureSyncLagRetention({ maxAgeMs: 10_000 });
    recordSyncLagSample(sample({ observedAt: T0 }));
    recordSyncLagSample(sample({ observedAt: T0 + 5_000 }));

    expect(pruneSyncLagSamples(T0 + 10_000)).toBe(0); // exactly at the edge: kept
    expect(pruneSyncLagSamples(T0 + 10_001)).toBe(1);
    expect(getSyncLagSamples().map((s) => s.observedAt)).toEqual([T0 + 5_000]);
  });

  it('keeps out-of-order reports sorted before pruning', () => {
    configureSyncLagRetention({ maxSamples: 2 });
    recordSyncLagSample(sample({ observedAt: T0 + 2 }));
    recordSyncLagSample(sample({ observedAt: T0 }));
    recordSyncLagSample(sample({ observedAt: T0 + 1 }));

    expect(getSyncLagSamples().map((s) => s.observedAt)).toEqual([T0 + 1, T0 + 2]);
  });

  it('cleanup is idempotent and safe on an empty history', () => {
    expect(pruneSyncLagSamples(T0)).toBe(0);
    expect(clearSyncLagSamples()).toBe(0);

    recordSyncLagSample(sample());
    recordSyncLagSample(sample({ observedAt: T0 + 1 }));
    expect(clearSyncLagSamples()).toBe(2);
    expect(clearSyncLagSamples()).toBe(0);
    expect(getSyncLagSamples()).toEqual([]);
  });

  it('ignores invalid retention settings', () => {
    const before = getSyncLagRetention();
    expect(configureSyncLagRetention({ maxSamples: 0, maxAgeMs: -1, staleAfterMs: 1.5 })).toEqual(
      before,
    );
  });

  it('shrinking the cap prunes existing samples immediately', () => {
    for (let i = 0; i < 4; i += 1) recordSyncLagSample(sample({ observedAt: T0 + i }));
    configureSyncLagRetention({ maxSamples: 1 });
    expect(getSyncLagSamples().map((s) => s.observedAt)).toEqual([T0 + 3]);
  });

  it('returned samples are copies', () => {
    recordSyncLagSample(sample());
    getSyncLagSamples()[0].lagMs = 1;
    expect(getSyncLagSamples()[0].lagMs).toBe(50_000);
  });
});

describe('monitorQueueHealth sync-lag alert', () => {
  it('alerts when a fresh sample exceeds the threshold', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    recordSyncLagSample(sample({ observedAt: Date.now() }));

    await monitorQueueHealth();

    const lines = log.mock.calls.map((args) => args.join(' '));
    expect(lines.some((l) => l.includes(ALERT_TYPES.SYNC_LAG_HIGH.toUpperCase()))).toBe(true);
  });
});
