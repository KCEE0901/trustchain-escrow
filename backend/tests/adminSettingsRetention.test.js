/**
 * Retention for dynamic admin settings persistence (#520): stale rows (keys
 * outside the allowlist) are pruned in bounded batches, allowlisted rows are
 * never touched, and a failing store prunes nothing and leaks no secrets.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const prismaMock = {
  platformSetting: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};
const logMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const logControllerError = jest.fn();

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../config/logger.js', () => ({
  getLogger: () => logMock,
  logControllerError,
}));
jest.unstable_mockModule('../lib/cache.js', () => ({
  default: { get: jest.fn(), set: jest.fn(), del: jest.fn(), invalidatePrefix: jest.fn() },
}));
jest.unstable_mockModule('../api/middleware/rateLimiter.js', () => ({
  getUserUsage: jest.fn(() => ({})),
}));
jest.unstable_mockModule('../config/rateLimits.js', () => ({
  TIER_LIMITS: { free: 100 },
}));

const { default: adminController, SETTINGS_PRUNE_BATCH_LIMIT } =
  await import('../api/controllers/adminController.js');

const delegate = prismaMock.platformSetting;
// A driver error whose message includes credentials; it must never surface.
const SECRET_DB_URL = ['postgres://admin', 's3cr3t@db.internal:5432/escrow'].join(':');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function req(body = {}) {
  return { id: 'req-1', user: { address: 'GADMIN' }, body };
}

function allLogOutput() {
  return JSON.stringify([
    logMock.warn.mock.calls,
    logMock.error.mock.calls,
    logControllerError.mock.calls,
  ]);
}

const staleRows = (n) =>
  Array.from({ length: n }, (_, i) => ({ key: `legacy_${String(i).padStart(3, '0')}` }));

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.platformSetting = delegate;
  delete process.env.ADMIN_SETTINGS_STORE_TIMEOUT_MS;
});

describe('POST /api/admin/settings/prune', () => {
  it('deletes only stale keys and keeps allowlisted settings', async () => {
    delegate.findMany.mockResolvedValue([{ key: 'zz_old' }, { key: 'aa_old' }]);
    delegate.deleteMany.mockResolvedValue({ count: 2 });
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      dryRun: false,
      matched: 2,
      removed: 2,
      keys: ['aa_old', 'zz_old'],
      hasMore: false,
      limit: SETTINGS_PRUNE_BATCH_LIMIT,
    });
    const query = delegate.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ key: { notIn: ['platformFeePercent'] } });
    expect(query.select).toEqual({ key: true });
    expect(delegate.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['zz_old', 'aa_old'], notIn: ['platformFeePercent'] } },
    });
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'admin_action', action: 'PRUNE_SETTINGS', removed: 2 }),
    );
  });

  it('never deletes an allowlisted key even if the store returns one', async () => {
    delegate.findMany.mockResolvedValue([{ key: 'platformFeePercent' }, { key: 'legacy' }]);
    delegate.deleteMany.mockResolvedValue({ count: 1 });
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.body.keys).toEqual(['legacy']);
    expect(delegate.deleteMany.mock.calls[0][0].where.key.in).toEqual(['legacy']);
  });

  it('dry run reports stale keys without deleting', async () => {
    delegate.findMany.mockResolvedValue([{ key: 'legacy' }]);
    const res = createRes();

    await adminController.pruneSettings(req({ dryRun: true }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, matched: 1, removed: 0, keys: ['legacy'] });
    expect(delegate.deleteMany).not.toHaveBeenCalled();
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('bounds one run to the batch limit and reports that more remain', async () => {
    delegate.findMany.mockResolvedValue(staleRows(SETTINGS_PRUNE_BATCH_LIMIT + 1));
    delegate.deleteMany.mockResolvedValue({ count: SETTINGS_PRUNE_BATCH_LIMIT });
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(delegate.findMany.mock.calls[0][0].take).toBe(SETTINGS_PRUNE_BATCH_LIMIT + 1);
    expect(delegate.deleteMany.mock.calls[0][0].where.key.in).toHaveLength(
      SETTINGS_PRUNE_BATCH_LIMIT,
    );
    expect(res.body).toMatchObject({ removed: SETTINGS_PRUNE_BATCH_LIMIT, hasMore: true });
  });

  it('is a no-op when nothing is stale', async () => {
    delegate.findMany.mockResolvedValue([]);
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.body).toMatchObject({ matched: 0, removed: 0, keys: [], hasMore: false });
    expect(delegate.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean dryRun without touching the store', async () => {
    const res = createRes();

    await adminController.pruneSettings(req({ dryRun: 'yes' }), res);

    expect(res.statusCode).toBe(400);
    expect(delegate.findMany).not.toHaveBeenCalled();
    expect(delegate.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 503 and deletes nothing when the store fails, without leaking the error', async () => {
    delegate.findMany.mockRejectedValue(new Error(`connect failed: ${SECRET_DB_URL}`));
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: 'Settings store is unavailable; nothing was pruned.',
      code: 'SETTINGS_STORE_UNAVAILABLE',
      removed: 0,
    });
    expect(delegate.deleteMany).not.toHaveBeenCalled();
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'admin_settings_degraded',
        operation: 'pruneSettings',
        reason: 'unavailable',
      }),
    );
    expect(allLogOutput()).not.toContain('s3cr3t');
    expect(JSON.stringify(res.body)).not.toContain('s3cr3t');
  });

  it('returns 503 when the delete itself fails', async () => {
    delegate.findMany.mockResolvedValue([{ key: 'legacy' }]);
    delegate.deleteMany.mockRejectedValue(
      Object.assign(new Error(SECRET_DB_URL), { code: 'P1001' }),
    );
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.statusCode).toBe(503);
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'pruneSettings', reason: 'prisma_P1001' }),
    );
    expect(allLogOutput()).not.toContain('s3cr3t');
  });

  it('returns 503 when the settings model is missing', async () => {
    prismaMock.platformSetting = undefined;
    const res = createRes();

    await adminController.pruneSettings(req(), res);

    expect(res.statusCode).toBe(503);
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'pruneSettings', reason: 'not_configured' }),
    );
  });
});
