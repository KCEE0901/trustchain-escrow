/**
 * Tests — Tenant-Level Metrics Access Control (Issue #191)
 *
 * Covers authorization for GET /metrics/tenant and GET /metrics/global:
 *
 *  - System admin can access /metrics/global
 *  - Tenant admin can access /metrics/tenant (own tenant only)
 *  - System admin can query any tenantId via ?tenantId= on /metrics/tenant
 *  - Normal authenticated user is denied both endpoints (403)
 *  - Unauthenticated request is denied (401)
 *  - GET /metrics requires METRICS_TOKEN when configured
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const prismaMock = {
  escrow: {
    groupBy: jest.fn(),
  },
  dispute: {
    count: jest.fn(),
  },
};

const metricsMock = {
  register: {
    metrics: jest.fn().mockResolvedValue('# HELP test\n'),
    contentType: 'text/plain; version=0.0.4',
  },
  cacheSize: { set: jest.fn() },
};

const cacheMock = { size: jest.fn().mockReturnValue(0) };

// Minimal auth middleware stub — sets req.user from X-Test-User header (JSON)
function testAuthMiddleware(req, _res, next) {
  const header = req.headers['x-test-user'];
  if (header) {
    try { req.user = JSON.parse(header); } catch { req.user = null; }
  }
  next();
}

jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../../lib/metrics.js', () => metricsMock);
jest.unstable_mockModule('../../lib/cache.js', () => ({ default: cacheMock }));
jest.unstable_mockModule('../middleware/auth.js', () => ({ default: testAuthMiddleware }));
jest.unstable_mockModule('../../config/logger.js', () => ({
  logControllerError: jest.fn(),
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// ── Build test app ────────────────────────────────────────────────────────────

async function buildApp() {
  const { default: metricsRouter } = await import('../routes/metricsRoutes.js');
  const app = express();
  app.use(express.json());
  app.use('/metrics', metricsRouter);
  return app;
}

// ── Supertest-style request helper (using http.request for zero extra deps) ───

import http from 'http';

function request(app) {
  return {
    get(path, headers = {}) {
      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, () => {
          const { port } = server.address();
          const options = {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'GET',
            headers: { 'Content-Type': 'application/json', ...headers },
          };
          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
              server.close();
              let parsed;
              try { parsed = JSON.parse(body); } catch { parsed = body; }
              resolve({ status: res.statusCode, body: parsed });
            });
          });
          req.on('error', (e) => { server.close(); reject(e); });
          req.end();
        });
      });
    },
  };
}

// ── User fixtures ─────────────────────────────────────────────────────────────

const SYSTEM_ADMIN = JSON.stringify({ address: '0xSYSADMIN', roles: ['Admin'] });
const TENANT_ADMIN = JSON.stringify({ address: '0xTADMIN', roles: ['tenant_admin'], tenantId: 'tenant-1' });
const NORMAL_USER  = JSON.stringify({ address: '0xUSER', roles: ['Client'] });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Metrics Access Control (#191)', () => {
  let app;

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    // Re-mock after resetModules
    jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));
    jest.unstable_mockModule('../../lib/metrics.js', () => metricsMock);
    jest.unstable_mockModule('../../lib/cache.js', () => ({ default: cacheMock }));
    jest.unstable_mockModule('../middleware/auth.js', () => ({ default: testAuthMiddleware }));
    jest.unstable_mockModule('../../config/logger.js', () => ({
      logControllerError: jest.fn(),
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
      createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    }));

    prismaMock.escrow.groupBy.mockResolvedValue([
      { status: 'Active', _count: { id: 5 } },
      { status: 'Completed', _count: { id: 3 } },
    ]);
    prismaMock.dispute.count.mockResolvedValue(2);

    app = await buildApp();
  });

  // ── GET /metrics/global ─────────────────────────────────────────────────────

  it('system admin can access /metrics/global', async () => {
    const { status } = await request(app).get('/metrics/global', { 'x-test-user': SYSTEM_ADMIN });
    expect(status).toBe(200);
  });

  it('tenant admin is denied /metrics/global (403)', async () => {
    const { status, body } = await request(app).get('/metrics/global', { 'x-test-user': TENANT_ADMIN });
    expect(status).toBe(403);
    expect(body.error).toMatch(/system admin/i);
  });

  it('normal user is denied /metrics/global (403)', async () => {
    const { status } = await request(app).get('/metrics/global', { 'x-test-user': NORMAL_USER });
    expect(status).toBe(403);
  });

  it('unauthenticated request to /metrics/global returns 401', async () => {
    const { status } = await request(app).get('/metrics/global');
    expect(status).toBe(401);
  });

  // ── GET /metrics/tenant ─────────────────────────────────────────────────────

  it('tenant admin can access /metrics/tenant and sees tenant-scoped data', async () => {
    const { status, body } = await request(app).get('/metrics/tenant', { 'x-test-user': TENANT_ADMIN });
    expect(status).toBe(200);
    expect(body).toHaveProperty('tenantId', 'tenant-1');
    expect(body.escrows).toHaveProperty('total');
    expect(body.disputes).toHaveProperty('open');
  });

  it('system admin can query any tenant via ?tenantId= on /metrics/tenant', async () => {
    const { status, body } = await request(app).get(
      '/metrics/tenant?tenantId=tenant-other',
      { 'x-test-user': SYSTEM_ADMIN },
    );
    expect(status).toBe(200);
    expect(body.tenantId).toBe('tenant-other');
  });

  it('normal user is denied /metrics/tenant (403)', async () => {
    const { status } = await request(app).get('/metrics/tenant', { 'x-test-user': NORMAL_USER });
    expect(status).toBe(403);
  });

  it('unauthenticated request to /metrics/tenant returns 401', async () => {
    const { status } = await request(app).get('/metrics/tenant');
    expect(status).toBe(401);
  });

  // ── GET /metrics — token protection ────────────────────────────────────────

  it('GET /metrics returns 401 when METRICS_TOKEN is set and token is missing', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    try {
      const { status } = await request(app).get('/metrics');
      expect(status).toBe(401);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });

  it('GET /metrics returns 200 when correct METRICS_TOKEN is provided', async () => {
    process.env.METRICS_TOKEN = 'secret-token';
    try {
      const { status } = await request(app).get('/metrics', {
        Authorization: 'Bearer secret-token',
      });
      expect(status).toBe(200);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});
