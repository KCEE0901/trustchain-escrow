import { jest } from '@jest/globals';

// ── Mocks ────────────────────────────────────────────────────────────────────

const prismaMock = { reputationRecord: { findUnique: jest.fn() } };
const reputationSearchMock = { leaderboard: jest.fn(), search: jest.fn() };
const reputationServiceMock = { recalculateFromEventHistory: jest.fn() };
const loggerMock = { error: jest.fn() };

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../services/reputationSearchService.js', () => reputationSearchMock);
jest.unstable_mockModule('../services/reputationService.js', () => reputationServiceMock);
jest.unstable_mockModule('../config/logger.js', () => ({ getLogger: () => loggerMock }));

const { default: reputationController } = await import('../api/controllers/reputationController.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

beforeEach(() => jest.clearAllMocks());

// ── recalculate: #233 regression — consistent null/undefined handling ────────
//
// recalculate() previously read the caller's role via `req.user || req.auth || {}`
// and `user.role || 'user'`, mixing truthy-OR fallbacks with the `??` used
// everywhere else in this file (getReputation, getLeaderboard). The two
// patterns only diverge for a falsy-but-present value (e.g. role === ''),
// which `||` silently coerces to the 'user' default and `??` does not.

describe('reputationController.recalculate', () => {
  it('denies access for a non-admin role', async () => {
    const req = { user: { role: 'user' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(403);
    expect(reputationServiceMock.recalculateFromEventHistory).not.toHaveBeenCalled();
  });

  it('denies access when role is an explicitly empty string rather than falling back to a default', async () => {
    const req = { user: { role: '' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(403);
    expect(reputationServiceMock.recalculateFromEventHistory).not.toHaveBeenCalled();
  });

  it('falls back to req.auth when req.user is absent', async () => {
    const req = { auth: { role: 'admin' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(200);
    expect(reputationServiceMock.recalculateFromEventHistory).toHaveBeenCalled();
  });

  it('allows access and recalculates for an admin role', async () => {
    const req = { user: { role: 'admin' }, tenant: { id: 't1' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(reputationServiceMock.recalculateFromEventHistory).toHaveBeenCalledWith('t1');
  });

  it('allows access for a superadmin role', async () => {
    const req = { user: { role: 'superadmin' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('denies access when neither req.user nor req.auth is present', async () => {
    const req = {};
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(403);
    expect(reputationServiceMock.recalculateFromEventHistory).not.toHaveBeenCalled();
  });

  it('returns 500 when the service throws', async () => {
    reputationServiceMock.recalculateFromEventHistory.mockRejectedValue(new Error('db down'));
    const req = { user: { role: 'admin' } };
    const res = createRes();

    await reputationController.recalculate(req, res);

    expect(res.statusCode).toBe(500);
  });
});
