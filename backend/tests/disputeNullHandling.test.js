/**
 * Regression tests for Issue #122:
 * Inconsistent null/undefined handling in disputeRoutes.js
 *
 * These tests verify that the `loadDispute` middleware standardizes on strict
 * equality (`=== null` / `=== undefined`) throughout — not a mix of `== null`,
 * `=== undefined`, or truthy guards — and that every route that needs a resolved
 * dispute object returns a clear 404 when the record is absent, rather than a
 * 500 from a downstream handler trying to access a property on `undefined`.
 *
 * Key regression case: previously, routes such as POST /:id/resolve/auto and
 * POST /:id/appeals called `req.dispute.id` without ever setting `req.dispute`,
 * causing a TypeError when the dispute was absent.  With `loadDispute` in place,
 * the request always short-circuits with a proper HTTP response.
 */

import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const prismaMock = {
  dispute: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  disputeAppeal: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const cacheMock = {
  get: jest.fn(),
  set: jest.fn(),
  setWithTags: jest.fn(),
  invalidate: jest.fn(),
  invalidateTags: jest.fn(),
  invalidatePrefix: jest.fn(),
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../lib/cache.js', () => ({ default: cacheMock }));

// Auth middleware — provide a user with ARBITRATOR role so all routes are reachable
jest.unstable_mockModule('../api/middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.user = {
      userId: 1,
      role: 'arbitrator',
      walletAddress: 'GTEST_WALLET',
      tenantId: 'tenant_default',
      type: 'access',
    };
    next();
  },
}));

// MFA middleware — bypass for tests
jest.unstable_mockModule('../api/middleware/mfaAuth.js', () => ({
  requireMfa: (_req, _res, next) => next(),
  requireMfaForHighValue: (_req, _res, next) => next(),
}));

// Role guard — allow all for these tests
jest.unstable_mockModule('../api/middleware/roleGuard.js', () => ({
  checkPermission: () => (_req, _res, next) => next(),
  ROLES: { ARBITRATOR: 'arbitrator', ADMIN: 'admin' },
}));

// File upload middleware — skip heavy multer setup
jest.unstable_mockModule('../api/middleware/fileUpload.js', () => ({
  handleUploadError: (_err, _req, _res, next) => next(),
  uploadEvidence: [(_req, _res, next) => next()],
}));

// WebSocket broadcast — no-op
jest.unstable_mockModule('../api/websocket/handlers.js', () => ({
  broadcastToDispute: jest.fn(),
}));

// IPFS services — not relevant for these tests
jest.unstable_mockModule('../services/ipfsService.js', () => ({
  default: { getFileUrl: jest.fn().mockResolvedValue('https://ipfs.io/test') },
}));

jest.unstable_mockModule('../services/ipfsHashService.js', () => ({
  verifyFile: jest.fn(),
  merkleRoot: jest.fn(),
  hashFile: jest.fn(),
}));

const { default: disputeRoutes } = await import('../api/routes/disputeRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenant = { id: 'tenant_default' };
    next();
  });
  app.use('/api/disputes', disputeRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheMock.get.mockReturnValue(null);
  prismaMock.dispute.findMany.mockResolvedValue([]);
  prismaMock.dispute.count.mockResolvedValue(0);
  // Prisma returns null (never undefined) for a missing record — use null here
  prismaMock.dispute.findFirst.mockResolvedValue(null);
  prismaMock.disputeAppeal.findFirst.mockResolvedValue(null);
});

// ── Core regression: loadDispute null vs undefined ────────────────────────────

describe('loadDispute middleware — null/undefined handling (Issue #122)', () => {
  it('returns 404 (not 500) when Prisma returns null for POST /:id/resolve/auto', async () => {
    /**
     * REGRESSION: before the fix, req.dispute was never set on this route.
     * autoResolve accessed req.dispute.id, producing:
     *   "TypeError: Cannot read properties of undefined (reading 'id')" → 500.
     * Now loadDispute short-circuits with 404 when dispute === null.
     */
    prismaMock.dispute.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/api/disputes/99/resolve/auto');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Dispute not found' });
  });

  it('returns 404 (not 500) when Prisma returns null for POST /:id/appeals', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .post('/api/disputes/99/appeals')
      .send({ reason: 'Test appeal' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Dispute not found' });
  });

  it('returns 404 (not 500) when Prisma returns null for GET /:id/resolve/recommendation', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get('/api/disputes/99/resolve/recommendation');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Dispute not found' });
  });

  it('returns 404 (not 500) when Prisma returns null for POST /:id/resolve', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).post('/api/disputes/99/resolve').send({});
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Dispute not found' });
  });
});

// ── loadDispute validation: bad id values ─────────────────────────────────────

describe('loadDispute middleware — id parameter validation', () => {
  it('returns 400 for a non-numeric dispute id', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/disputes/abc/resolve/auto');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('positive integer') });
    // Prisma must not be called when the id is invalid
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for id zero', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/disputes/0/resolve/auto');
    expect(res.status).toBe(400);
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for a negative id', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/disputes/-1/resolve/auto');
    expect(res.status).toBe(400);
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for a float id', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/disputes/1.5/resolve/auto');
    expect(res.status).toBe(400);
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });
});

// ── Happy-path: valid dispute — no TypeError ──────────────────────────────────

describe('loadDispute middleware — valid dispute flows', () => {
  const mockDispute = {
    id: 42,
    escrowId: 7n,
    tenantId: 'tenant_default',
    raisedByAddress: 'GCLIENT',
    resolvedAt: null,
    resolution: null,
    escrow: {
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREELANCER',
    },
  };

  it('proceeds to controller when dispute exists for POST /:id/resolve/auto', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(mockDispute);
    prismaMock.dispute.update.mockResolvedValue({ ...mockDispute, resolvedAt: new Date() });
    const app = buildApp();
    const res = await request(app).post('/api/disputes/42/resolve/auto');
    expect(res.status).toBe(200);
    expect(prismaMock.dispute.update).toHaveBeenCalled();
  });

  it('proceeds to controller when dispute exists for POST /:id/appeals', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(mockDispute);
    prismaMock.disputeAppeal.create.mockResolvedValue({
      id: 1,
      disputeId: 42,
      reason: 'Test',
      appealedBy: 'GTEST_WALLET',
    });
    const app = buildApp();
    const res = await request(app)
      .post('/api/disputes/42/appeals')
      .send({ reason: 'Test appeal reason' });
    expect(res.status).toBe(201);
  });

  it('calls Prisma exactly once per request — no behavior change for valid inputs', async () => {
    prismaMock.dispute.findFirst.mockResolvedValue(mockDispute);
    prismaMock.dispute.update.mockResolvedValue({ ...mockDispute, resolvedAt: new Date() });
    const app = buildApp();

    await request(app).post('/api/disputes/42/resolve/auto');

    // loadDispute calls findFirst once; the controller may call update
    expect(prismaMock.dispute.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42, tenantId: 'tenant_default' } }),
    );
  });
});
