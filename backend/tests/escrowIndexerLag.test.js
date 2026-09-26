import { jest } from '@jest/globals';

const gauge = () => ({ set: jest.fn() });
const metricsMock = {
  indexerLatestLedger: gauge(),
  indexerProcessedLedger: gauge(),
  indexerLedgerLag: gauge(),
  indexerLagAlert: gauge(),
};
const logMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: {} }));
jest.unstable_mockModule('../lib/metrics.js', () => metricsMock);
jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => logMock,
}));

const { recordIndexerLag } = await import('../services/escrowIndexer.js');

describe('escrowIndexer lag metrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports a healthy state when lag is within the threshold', () => {
    const result = recordIndexerLag(1050, 1000, 100);

    expect(result).toEqual({ latestLedger: 1050, processedLedger: 1000, lag: 50, lagging: false });
    expect(metricsMock.indexerLatestLedger.set).toHaveBeenCalledWith(1050);
    expect(metricsMock.indexerProcessedLedger.set).toHaveBeenCalledWith(1000);
    expect(metricsMock.indexerLedgerLag.set).toHaveBeenCalledWith(50);
    expect(metricsMock.indexerLagAlert.set).toHaveBeenCalledWith(0);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('raises an alert when lag exceeds the threshold', () => {
    const result = recordIndexerLag(1500, 1000, 100);

    expect(result.lag).toBe(500);
    expect(result.lagging).toBe(true);
    expect(metricsMock.indexerLagAlert.set).toHaveBeenCalledWith(1);
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'indexer_lag_alert', lag: 500, threshold: 100 }),
    );
  });

  it('never reports negative lag', () => {
    expect(recordIndexerLag(900, 1000, 100).lag).toBe(0);
    expect(metricsMock.indexerLedgerLag.set).toHaveBeenCalledWith(0);
  });
});
