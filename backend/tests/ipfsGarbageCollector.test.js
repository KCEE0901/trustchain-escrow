/**
 * Tests for backend/services/ipfsGarbageCollector.js — dry-run report
 */

import { jest } from '@jest/globals';

process.env.PINATA_JWT = 'test-jwt';

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: { disputeEvidence: { findMany: mockFindMany, findFirst: mockFindFirst } },
}));

jest.unstable_mockModule('../config/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const { runGarbageCollector } = await import('../services/ipfsGarbageCollector.js');

const pinnedAt = new Date(Date.now() - 48 * 3_600_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([{ ipfsCid: 'QmUsed', thumbnailCid: null }]);
  mockFindFirst.mockResolvedValue(null);
  mockFetch.mockImplementation(async (url, opts = {}) => {
    if (opts.method === 'DELETE') return { ok: true };
    return {
      ok: true,
      json: async () => ({
        rows: [
          { ipfs_pin_hash: 'QmUsed', date_pinned: pinnedAt },
          { ipfs_pin_hash: 'QmOrphan', date_pinned: pinnedAt },
        ],
      }),
    };
  });
});

describe('runGarbageCollector dry run', () => {
  it('reports candidate count, reason and age', async () => {
    const { report } = await runGarbageCollector({ dryRun: true });

    expect(report).toEqual({
      dryRun: true,
      candidateCount: 1,
      candidates: [{ cid: 'QmOrphan', reason: 'unreferenced', ageHours: 48 }],
    });
  });

  it('does not call any mutating provider endpoint', async () => {
    const result = await runGarbageCollector({ dryRun: true });

    expect(result.unpinned).toEqual([]);
    for (const [, opts] of mockFetch.mock.calls) {
      expect(opts?.method).toBeUndefined();
    }
  });

  it('unpins candidates when not a dry run', async () => {
    const result = await runGarbageCollector();

    expect(result.unpinned).toEqual(['QmOrphan']);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/unpin/QmOrphan',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
