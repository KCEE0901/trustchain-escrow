/**
 * Integration tests for auditService.js — happy-path flow
 *
 * Covers:
 *  - log() writes a record via prisma and survives DB errors silently
 *  - search() with various filter combinations and pagination
 *  - exportCsv() column structure and row content
 *  - purgeOldRecords() deletes the right rows
 *  - AuditCategory and AuditAction constant exports
 *
 * Closes #95
 */

import { jest } from '@jest/globals';

// ── Prisma mock ───────────────────────────────────────────────────────────────

let _store = [];
let _nextId = 1;

function resetStore() {
  _store = [];
  _nextId = 1;
}

const auditLogModel = {
  create: jest.fn(async ({ data }) => {
    const record = {
      id: _nextId++,
      ...data,
      createdAt: data.createdAt ?? new Date(),
    };
    _store.push(record);
    return record;
  }),
  findMany: jest.fn(async ({ where = {}, skip = 0, take = 50, orderBy, select } = {}) => {
    let rows = _store.filter((r) => {
      if (where.category && r.category !== where.category) return false;
      if (where.action && r.action !== where.action) return false;
      if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
      if (where.createdAt?.lt && r.createdAt >= where.createdAt.lt) return false;
      return true;
    });
    rows = rows.sort((a, b) => b.createdAt - a.createdAt);
    const page = rows.slice(skip, skip + take);
    if (select) {
      return page.map((r) => {
        const out = {};
        Object.keys(select).forEach((k) => {
          if (k in r) out[k] = r[k];
        });
        return out;
      });
    }
    return page;
  }),
  count: jest.fn(async ({ where = {} } = {}) => {
    return _store.filter((r) => {
      if (where.category && r.category !== where.category) return false;
      if (where.action && r.action !== where.action) return false;
      return true;
    }).length;
  }),
  deleteMany: jest.fn(async ({ where = {} } = {}) => {
    const before = _store.length;
    _store = _store.filter((r) => {
      if (where.createdAt?.lt && r.createdAt < where.createdAt.lt) return false;
      return true;
    });
    return { count: before - _store.length };
  }),
};

jest.mock('../../lib/prisma.js', () => ({
  default: {
    auditLog: auditLogModel,
    $transaction: jest.fn(async (ops) => Promise.all(ops)),
  },
}));

// ── Tracing mock ──────────────────────────────────────────────────────────────

jest.mock('../../lib/tracing.js', () => ({
  withSpan: jest.fn(async (_name, _attrs, fn) => fn()),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────

jest.mock('../../config/logger.js', () => ({
  createModuleLogger: () => ({ error: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
}));

// ── csv-stringify mock ────────────────────────────────────────────────────────

jest.mock('csv-stringify/sync', () => ({
  stringify: jest.fn((rows, opts) => {
    const cols = opts.columns;
    const header = cols.join(',') + '\n';
    const body = rows.map((r) => cols.map((c) => r[c] ?? '').join(',')).join('\n');
    return header + (body ? body + '\n' : '');
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  log,
  search,
  exportCsv,
  purgeOldRecords,
  AuditCategory,
  AuditAction,
} = await import('../../services/auditService.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedEntry(overrides = {}) {
  return log({
    category: AuditCategory.AUTH,
    action: AuditAction.LOGIN,
    actor: 'GACTOR1',
    ...overrides,
  });
}

// ── AuditCategory / AuditAction constants ────────────────────────────────────

describe('AuditCategory', () => {
  it('exports all expected category keys', () => {
    ['AUTH', 'ESCROW', 'MILESTONE', 'DISPUTE', 'ADMIN', 'PAYMENT', 'KYC', 'REPORTING'].forEach(
      (key) => expect(AuditCategory[key]).toBe(key),
    );
  });
});

describe('AuditAction', () => {
  it('exports LOGIN and LOGOUT actions', () => {
    expect(AuditAction.LOGIN).toBe('LOGIN');
    expect(AuditAction.LOGOUT).toBe('LOGOUT');
  });

  it('exports RAISE_DISPUTE and RESOLVE_DISPUTE actions', () => {
    expect(AuditAction.RAISE_DISPUTE).toBe('RAISE_DISPUTE');
    expect(AuditAction.RESOLVE_DISPUTE).toBe('RESOLVE_DISPUTE');
  });

  it('exports PAYMENT_INITIATED and PAYMENT_COMPLETED actions', () => {
    expect(AuditAction.PAYMENT_INITIATED).toBe('PAYMENT_INITIATED');
    expect(AuditAction.PAYMENT_COMPLETED).toBe('PAYMENT_COMPLETED');
  });
});

// ── log() ─────────────────────────────────────────────────────────────────────

describe('log()', () => {
  beforeEach(resetStore);

  it('writes a record with the correct fields', async () => {
    await seedEntry({ resourceId: 'escrow-1', statusCode: 200, ipAddress: '127.0.0.1' });
    expect(auditLogModel.create).toHaveBeenCalledTimes(1);
    const { data } = auditLogModel.create.mock.calls[0][0];
    expect(data.category).toBe(AuditCategory.AUTH);
    expect(data.action).toBe(AuditAction.LOGIN);
    expect(data.actor).toBe('GACTOR1');
    expect(data.resourceId).toBe('escrow-1');
    expect(data.statusCode).toBe(200);
    expect(data.ipAddress).toBe('127.0.0.1');
  });

  it('sets resourceId to null when not provided', async () => {
    await seedEntry();
    const { data } = auditLogModel.create.mock.calls[0][0];
    expect(data.resourceId).toBeNull();
  });

  it('does not throw when prisma throws', async () => {
    auditLogModel.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(seedEntry()).resolves.toBeUndefined();
  });

  it('swallows DB errors silently so the calling request is not disrupted', async () => {
    auditLogModel.create.mockRejectedValueOnce(new Error('connection lost'));
    await seedEntry(); // must not throw
  });
});

// ── search() ──────────────────────────────────────────────────────────────────

describe('search()', () => {
  beforeEach(async () => {
    resetStore();
    jest.clearAllMocks();
    // Re-wire $transaction to use our fake model
    const prisma = (await import('../../lib/prisma.js')).default;
    prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));

    await seedEntry({ category: AuditCategory.AUTH, action: AuditAction.LOGIN });
    await seedEntry({ category: AuditCategory.ESCROW, action: AuditAction.CREATE_ESCROW });
    await seedEntry({ category: AuditCategory.DISPUTE, action: AuditAction.RAISE_DISPUTE });
  });

  it('returns all records with default pagination', async () => {
    const result = await search();
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.pages).toBe(1);
  });

  it('filters by category', async () => {
    const result = await search({ category: AuditCategory.AUTH });
    expect(result.total).toBe(1);
    expect(result.data[0].action).toBe(AuditAction.LOGIN);
  });

  it('filters by action', async () => {
    const result = await search({ action: AuditAction.RAISE_DISPUTE });
    expect(result.total).toBe(1);
    expect(result.data[0].category).toBe(AuditCategory.DISPUTE);
  });

  it('respects the page and limit params', async () => {
    const result = await search({ limit: 2, page: 1 });
    expect(result.limit).toBe(2);
    expect(result.pages).toBe(2);
  });

  it('clamps limit to a maximum of 200', async () => {
    const result = await search({ limit: 9999 });
    expect(result.limit).toBe(200);
  });

  it('defaults page to 1 for non-numeric page values', async () => {
    const result = await search({ page: 'abc' });
    expect(result.page).toBe(1);
  });
});

// ── exportCsv() ───────────────────────────────────────────────────────────────

describe('exportCsv()', () => {
  beforeEach(async () => {
    resetStore();
    jest.clearAllMocks();
    await seedEntry({ resourceId: 'res-1', statusCode: 200, ipAddress: '10.0.0.1' });
  });

  it('returns a CSV string with the correct header columns', async () => {
    const csv = await exportCsv();
    const header = csv.split('\n')[0];
    expect(header).toContain('id');
    expect(header).toContain('category');
    expect(header).toContain('action');
    expect(header).toContain('actor');
    expect(header).toContain('createdAt');
  });

  it('includes a data row for each matching record', async () => {
    await seedEntry();
    const csv = await exportCsv();
    const lines = csv.trim().split('\n');
    // header + 2 data rows
    expect(lines.length).toBe(3);
  });

  it('applies category filter correctly', async () => {
    await seedEntry({ category: AuditCategory.ADMIN, action: AuditAction.SUSPEND_USER });
    const csv = await exportCsv({ category: AuditCategory.AUTH });
    const lines = csv.trim().split('\n');
    // header + 1 AUTH row only
    expect(lines.length).toBe(2);
  });
});

// ── purgeOldRecords() ─────────────────────────────────────────────────────────

describe('purgeOldRecords()', () => {
  beforeEach(resetStore);

  it('deletes records older than the retention window', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 100);
    _store.push({
      id: _nextId++,
      category: AuditCategory.AUTH,
      action: AuditAction.LOGIN,
      actor: 'old-actor',
      createdAt: old,
    });

    const count = await purgeOldRecords(30);
    expect(count).toBe(1);
  });

  it('returns 0 when there are no records to purge', async () => {
    const count = await purgeOldRecords(30);
    expect(count).toBe(0);
  });

  it('does not delete records within the retention window', async () => {
    await seedEntry();
    const count = await purgeOldRecords(30);
    expect(count).toBe(0);
  });
});
