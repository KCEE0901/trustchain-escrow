'use strict';

/**
 * Tests for alertService indexer sync-lag calculation.
 *
 * Covers the primary success path plus failure/boundary paths for the
 * graceful degradation behavior added in issue #529: when optional indexer
 * infrastructure is unavailable, the sync-lag calculation must return a
 * stable degraded response instead of throwing.
 */

const alertService = require('../alertService');

// Helper: build a minimal indexer status payload the service understands.
function makeIndexerStatus(overrides = {}) {
  return {
    latestIndexedBlock: 1000,
    latestChainBlock: 1000,
    lastIndexedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

describe('alertService indexer sync-lag calculation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes sync lag on the primary success path', async () => {
    const status = makeIndexerStatus({
      latestIndexedBlock: 990,
      latestChainBlock: 1000,
    });

    const result = await alertService.calculateIndexerSyncLag(status);

    expect(result).toEqual(
      expect.objectContaining({
        degraded: false,
        lagBlocks: 10,
      }),
    );
  });

  it('returns a stable degraded response when indexer status is unavailable', async () => {
    const result = await alertService.calculateIndexerSyncLag(null);

    expect(result).toEqual(
      expect.objectContaining({
        degraded: true,
        lagBlocks: null,
      }),
    );
  });

  it('returns a stable degraded response when indexer status is malformed', async () => {
    const result = await alertService.calculateIndexerSyncLag({
      latestIndexedBlock: 'not-a-number',
      latestChainBlock: undefined,
    });

    expect(result).toEqual(
      expect.objectContaining({
        degraded: true,
        lagBlocks: null,
      }),
    );
  });

  it('treats a negative lag boundary as zero without degrading', async () => {
    const status = makeIndexerStatus({
      latestIndexedBlock: 1005,
      latestChainBlock: 1000,
    });

    const result = await alertService.calculateIndexerSyncLag(status);

    expect(result).toEqual(
      expect.objectContaining({
        degraded: false,
        lagBlocks: 0,
      }),
    );
  });

  it('does not throw when the underlying indexer call rejects', async () => {
    const status = makeIndexerStatus();
    const spy = jest
      .spyOn(alertService, '_fetchIndexerStatus')
      .mockRejectedValue(new Error('indexer offline'));

    const result = await alertService.calculateIndexerSyncLag(status);

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        degraded: true,
        lagBlocks: null,
      }),
    );
  });
});
