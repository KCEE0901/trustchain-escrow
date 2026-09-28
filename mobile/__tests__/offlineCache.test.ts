import type * as OfflineCache from '../services/offlineCache';

// In-memory fake for expo-sqlite, scoped per test via jest.resetModules().
jest.mock('expo-sqlite', () => {
  let escrows = new Map<string, { id: string; data: string; cached_at: number }>();
  let milestones = new Map<
    number,
    { id: number; escrow_id: string; data: string; cached_at: number }
  >();

  const db = {
    execSync: jest.fn(),
    runSync: jest.fn((sql: string, params: unknown[] = []) => {
      if (/INSERT OR REPLACE INTO escrows/.test(sql)) {
        const [id, data, cached_at] = params as [string, string, number];
        escrows.set(id, { id, data, cached_at });
      } else if (/DELETE FROM escrows WHERE id = \?/.test(sql)) {
        escrows.delete(params[0] as string);
      } else if (/DELETE FROM escrows WHERE cached_at < \?/.test(sql)) {
        const cutoff = params[0] as number;
        for (const [id, row] of escrows) if (row.cached_at < cutoff) escrows.delete(id);
      } else if (/DELETE FROM escrows/.test(sql)) {
        escrows.clear();
      } else if (/INSERT INTO milestones/.test(sql)) {
        const [id, escrow_id, data, cached_at] = params as [number, string, string, number];
        milestones.set(id, { id, escrow_id, data, cached_at });
      } else if (/DELETE FROM milestones WHERE escrow_id = \? AND cached_at < \?/.test(sql)) {
        const [escrowId, cutoff] = params as [string, number];
        for (const [id, row] of milestones) {
          if (row.escrow_id === escrowId && row.cached_at < cutoff) milestones.delete(id);
        }
      } else if (/DELETE FROM milestones WHERE escrow_id = \?/.test(sql)) {
        for (const [id, row] of milestones) if (row.escrow_id === params[0]) milestones.delete(id);
      } else if (/DELETE FROM milestones/.test(sql)) {
        milestones.clear();
      }
    }),
    getFirstSync: jest.fn((sql: string, params: unknown[] = []) => {
      if (/FROM escrows WHERE id = \?/.test(sql)) return escrows.get(params[0] as string) ?? null;
      return null;
    }),
    getAllSync: jest.fn((sql: string, params: unknown[] = []) => {
      if (/FROM escrows/.test(sql)) {
        return Array.from(escrows.values()).sort((a, b) => b.cached_at - a.cached_at);
      }
      if (/FROM milestones WHERE escrow_id = \?/.test(sql)) {
        return Array.from(milestones.values())
          .filter((m) => m.escrow_id === params[0])
          .sort((a, b) => a.id - b.id);
      }
      return [];
    }),
  };

  return {
    openDatabaseSync: jest.fn(() => db),
    __reset: () => {
      escrows = new Map();
      milestones = new Map();
    },
  };
});

describe('offlineCache', () => {
  let cache: typeof OfflineCache;

  beforeEach(() => {
    jest.resetModules();
    (jest.requireMock('expo-sqlite') as { __reset: () => void }).__reset();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cache = require('../services/offlineCache');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores and retrieves a cached escrow', () => {
    cache.cacheEscrow({ id: '1', status: 'Active' });

    expect(cache.getCachedEscrow('1')).toEqual({ id: '1', status: 'Active' });
  });

  it('returns null for an escrow that was never cached', () => {
    expect(cache.getCachedEscrow('missing')).toBeNull();
  });

  it('returns cached escrows that are within the TTL window', () => {
    cache.cacheEscrow({ id: '1', status: 'Active' });
    cache.cacheEscrow({ id: '2', status: 'Completed' });

    const all = cache.getCachedEscrows();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id).sort()).toEqual(['1', '2']);
  });

  it('evicts an escrow once it is older than the TTL', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    cache.cacheEscrow({ id: '1', status: 'Active' });

    // Default TTL is 5 minutes — advance past it.
    jest.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

    expect(cache.getCachedEscrow('1')).toBeNull();
    expect(cache.getCachedEscrows()).toHaveLength(0);
  });

  it('caches and retrieves milestones for an escrow', () => {
    cache.cacheMilestones('1', [
      { id: 10, title: 'Design' },
      { id: 11, title: 'Build' },
    ]);

    expect(cache.getCachedMilestones('1')).toEqual([
      { id: 10, title: 'Design' },
      { id: 11, title: 'Build' },
    ]);
  });

  it('clearCache removes all cached escrows and milestones', () => {
    cache.cacheEscrow({ id: '1', status: 'Active' });
    cache.cacheMilestones('1', [{ id: 10, title: 'Design' }]);

    cache.clearCache();

    expect(cache.getCachedEscrows()).toHaveLength(0);
    expect(cache.getCachedMilestones('1')).toHaveLength(0);
  });
});
