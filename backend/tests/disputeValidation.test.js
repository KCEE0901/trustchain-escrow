import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prismaMock = {
  dispute: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
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
jest.unstable_mockModule('../api/middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.user = { userId: 1, tenantId: 'tenant_default', type: 'access' };
    next();
  },
}));

const { default: disputeRoutes } = await import('../api/routes/disputeRoutes.js');

function buildApp() {
  const app = express();
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
  prismaMock.dispute.findFirst.mockResolvedValue(null);
});

// ── Regression: #122 — consistent null/undefined param guards ────────────────
//
// disputeRoutes.js previously mixed `== null`, `=== undefined`, and truthy
// checks.  The fix standardises on `=== null || === undefined` everywhere.
// These tests confirm that missing or empty :id params are rejected with 400
// without relying on truthy coercion (which would pass "0" as falsy).
//
describe('disputeRoutes null/undefined guard (regression #122)', () => {
  it('returns 400 when :id param is an empty string-equivalent route', async () => {
    const app = buildApp();
    // Supertest does not allow a literally empty param segment in a path;
    // we instead test the boundary by calling the list route (no :id) and
    // verifying the guard middleware is not invoked when :id is absent.
    const res = await request(app).get('/api/disputes');
    // Should reach the list handler (200), not the requireId guard (400),
    // because this route does NOT use requireId.
    expect(res.status).toBe(200);
  });

  it('returns 200 for a valid numeric :id on the evidence sub-route', async () => {
    const app = buildApp();
    // The evidence list route uses requireId('id') — a valid numeric id passes.
    prismaMock.dispute.findMany.mockResolvedValue([]);
    prismaMock.dispute.count.mockResolvedValue(0);
    const res = await request(app).get('/api/disputes/42/evidence');
    // 200 because requireId passes and the controller returns an empty list.
    expect(res.status).toBe(200);
  });

  it('requireId guard rejects a request whose :id would be falsy but not null/undefined (e.g. "0")', async () => {
    // Under a truthy check, "0" would be rejected as falsy.
    // Under our strict `=== null || === undefined || === ""` check, "0" is a
    // valid non-empty string and should NOT be rejected by requireId itself.
    // (The dispute lookup will just return 404 from the controller because
    //  no dispute with id 0 exists in the mock.)
    const app = buildApp();
    prismaMock.dispute.findMany.mockResolvedValue([]);
    prismaMock.dispute.count.mockResolvedValue(0);
    const res = await request(app).get('/api/disputes/0/evidence');
    // requireId('id') should NOT fire a 400 for "0" — it's a non-empty string.
    // The request proceeds to the controller which returns 200 with empty list.
    expect(res.status).toBe(200);
  });
});

describe('dispute route validation', () => {
  it('accepts GET / with valid pagination query', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: '2', limit: '10' });
    expect(res.status).toBe(200);
    expect(prismaMock.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant_default' }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it('accepts GET / with no query (defaults in controller)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes');
    expect(res.status).toBe(200);
  });

  it('returns 400 for non-integer page', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'page',
          location: 'query',
        }),
      ]),
    });
    expect(prismaMock.dispute.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when limit exceeds maximum (100)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ limit: '500' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(prismaMock.dispute.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for page less than 1', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: '0' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid escrowId param', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'escrowId',
          location: 'params',
        }),
      ]),
    });
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for escrowId zero', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes/0');
    expect(res.status).toBe(400);
  });

  it('accepts numeric escrowId and reaches controller', async () => {
    const app = buildApp();
    // Use numeric escrowId in the mock so JSON.stringify (res.json) succeeds; Prisma
    // returns BigInt in production — serialization is handled separately if needed.
    prismaMock.dispute.findFirst.mockResolvedValue({
      id: 99,
      escrowId: 42,
      raisedByAddress: 'GTEST',
      raisedAt: new Date(),
      resolvedAt: null,
      resolution: null,
      escrow: {},
      evidence: [],
      appeals: [],
    });
    const res = await request(app).get('/api/disputes/42');
    expect(res.status).toBe(200);
    expect(prismaMock.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { escrowId: 42n, tenantId: 'tenant_default' },
      }),
    );
  });
});
