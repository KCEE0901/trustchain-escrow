/**
 * Dynamic admin settings persistence (#519): persisted overrides on the happy
 * path, and a stable degraded response when the settings store is missing,
 * failing or slow. Logs and responses never carry raw driver errors.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const prismaMock = {
  platformSetting: {
    findMany: jest.fn(),
    upsert: jest.fn(),
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

const { default: adminController } = await import('../api/controllers/adminController.js');

const platformSettingDelegate = prismaMock.platformSetting;
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

function req(overrides = {}) {
  return { id: 'req-1', user: { address: 'GADMIN' }, body: {}, ...overrides };
}

function allLogOutput() {
  return JSON.stringify([logMock.warn.mock.calls, logMock.error.mock.calls, logControllerError.mock.calls]);
}

const DEFAULTS = {
  platformFeePercent: '1.5',
  stellarNetwork: 'testnet',
  allowedOrigins: 'http://localhost:3000',
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.platformSetting = platformSettingDelegate;
  delete process.env.PLATFORM_FEE_PERCENT;
  delete process.env.STELLAR_NETWORK;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.ADMIN_SETTINGS_STORE_TIMEOUT_MS;
});

afterEach(() => {
  prismaMock.platformSetting = platformSettingDelegate;
});

describe('GET /api/admin/settings', () => {
  it('overlays persisted overrides on the env defaults', async () => {
    platformSettingDelegate.findMany.mockResolvedValue([{ key: 'platformFeePercent', value: '2.25' }]);
    const res = createRes();

    await adminController.getSettings(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...DEFAULTS, platformFeePercent: '2.25', persistence: { status: 'ok' } });
    expect(platformSettingDelegate.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['platformFeePercent'] } },
    });
  });

  it('returns the defaults when nothing has been persisted yet', async () => {
    platformSettingDelegate.findMany.mockResolvedValue([]);
    const res = createRes();

    await adminController.getSettings(req(), res);

    expect(res.body).toEqual({ ...DEFAULTS, persistence: { status: 'ok' } });
  });

  it('degrades to a stable 200 response when the database errors, without leaking the error', async () => {
    platformSettingDelegate.findMany.mockRejectedValue(
      Object.assign(new Error(`Can't reach database server at ${SECRET_DB_URL}`), { code: 'P1001' }),
    );
    const first = createRes();
    const second = createRes();

    await adminController.getSettings(req(), first);
    await adminController.getSettings(req(), second);

    const expected = {
      ...DEFAULTS,
      persistence: { status: 'degraded', reason: 'settings_store_unavailable' },
    };
    expect(first.statusCode).toBe(200);
    expect(first.body).toEqual(expected);
    expect(second.body).toEqual(first.body);

    expect(logMock.warn).toHaveBeenCalledWith({
      type: 'admin_settings_degraded',
      operation: 'getSettings',
      reason: 'prisma_P1001',
      requestId: 'req-1',
    });
    expect(allLogOutput()).not.toContain('s3cr3t');
    expect(JSON.stringify(first.body)).not.toContain('s3cr3t');
  });

  it('degrades instead of hanging when the store does not answer in time', async () => {
    process.env.ADMIN_SETTINGS_STORE_TIMEOUT_MS = '20';
    platformSettingDelegate.findMany.mockReturnValue(new Promise(() => {}));
    const res = createRes();

    await adminController.getSettings(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.persistence).toEqual({ status: 'degraded', reason: 'settings_store_unavailable' });
    expect(logMock.warn.mock.calls[0][0].reason).toBe('timeout');
  });

  it('degrades when the Prisma client has no settings model', async () => {
    prismaMock.platformSetting = undefined;
    const res = createRes();

    await adminController.getSettings(req(), res);

    expect(res.body).toEqual({
      ...DEFAULTS,
      persistence: { status: 'degraded', reason: 'settings_store_unavailable' },
    });
    expect(logMock.warn.mock.calls[0][0].reason).toBe('not_configured');
  });

  it('ignores a corrupted persisted fee and keeps the default', async () => {
    platformSettingDelegate.findMany.mockResolvedValue([
      { key: 'platformFeePercent', value: 'not-a-number' },
    ]);
    const res = createRes();

    await adminController.getSettings(req(), res);

    expect(res.body.platformFeePercent).toBe('1.5');
    expect(res.body.persistence).toEqual({ status: 'ok' });
  });
});

describe('PATCH /api/admin/settings', () => {
  it('persists a valid fee deterministically and reports what was saved', async () => {
    platformSettingDelegate.upsert.mockResolvedValue({});
    const res = createRes();

    await adminController.updateSettings(
      req({ body: { platformFeePercent: '2.50', stellarNetwork: 'mainnet' } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(platformSettingDelegate.upsert).toHaveBeenCalledTimes(1);
    expect(platformSettingDelegate.upsert).toHaveBeenCalledWith({
      where: { key: 'platformFeePercent' },
      update: { value: '2.5', updatedBy: 'GADMIN' },
      create: { key: 'platformFeePercent', value: '2.5', updatedBy: 'GADMIN' },
    });
    expect(res.body).toMatchObject({
      message: 'Settings updated.',
      persisted: ['platformFeePercent'],
      ignored: ['stellarNetwork'],
      settings: { ...DEFAULTS, platformFeePercent: '2.5' },
    });
  });

  it('still rejects an invalid fee with 400 and writes nothing', async () => {
    for (const platformFeePercent of ['abc', -1, 101]) {
      const res = createRes();
      await adminController.updateSettings(req({ body: { platformFeePercent } }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'platformFeePercent must be a number between 0 and 100.' });
    }
    expect(platformSettingDelegate.upsert).not.toHaveBeenCalled();
  });

  it('accepts the 0 and 100 boundaries', async () => {
    platformSettingDelegate.upsert.mockResolvedValue({});
    for (const [input, stored] of [
      [0, '0'],
      ['100', '100'],
    ]) {
      const res = createRes();
      await adminController.updateSettings(req({ body: { platformFeePercent: input } }), res);
      expect(res.statusCode).toBe(200);
      expect(platformSettingDelegate.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ value: stored }) }),
      );
    }
  });

  it('returns a stable 503 and does not claim success when the store is down', async () => {
    platformSettingDelegate.upsert.mockRejectedValue(new Error(`connect ECONNREFUSED ${SECRET_DB_URL}`));
    const res = createRes();

    await adminController.updateSettings(req({ body: { platformFeePercent: 3 } }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: 'Settings store is unavailable; no changes were saved.',
      code: 'SETTINGS_STORE_UNAVAILABLE',
      persisted: [],
    });
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'admin_settings_degraded', reason: 'unavailable' }),
    );
    expect(logMock.warn).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'admin_action' }));
    expect(allLogOutput()).not.toContain('s3cr3t');
  });

  it('does not touch the store when nothing persistable was sent', async () => {
    const res = createRes();

    await adminController.updateSettings(req({ body: { allowedOrigins: '*' } }), res);

    expect(res.statusCode).toBe(200);
    expect(platformSettingDelegate.upsert).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      message: 'No persistable settings provided.',
      persisted: [],
      ignored: ['allowedOrigins'],
    });
  });
});
