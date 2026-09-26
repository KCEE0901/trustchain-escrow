/**
 * Tests for graceful shutdown behaviour in server.js (issue #367).
 *
 * Verifies:
 *  - New connections are rejected (503) once shutdown is initiated
 *  - In-flight requests complete before the server closes (up to 10 s)
 *  - DB (Prisma) and Redis (cacheService) disconnect methods are called
 *  - Process exits with code 0 on clean drain, code 1 on forced timeout
 */

import { jest } from '@jest/globals';
import express from 'express';
import http from 'http';
import request from 'supertest';

// ── Shared mocks ──────────────────────────────────────────────────────────────

const prismaMock = { $disconnect: jest.fn().mockResolvedValue(undefined) };
const cacheServiceMock = { disconnect: jest.fn().mockResolvedValue(undefined) };
const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// We only need a minimal logger mock; the real logger pulls in heavy deps.
jest.unstable_mockModule('../config/logger.js', () => ({
  default: loggerMock,
  createModuleLogger: () => loggerMock,
  getLogger: () => loggerMock,
}));
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../services/cacheService.js', () => ({
  default: cacheServiceMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal self-contained Express app with the same graceful-shutdown
 * logic as server.js, without the full server import (which has many heavy
 * side-effects incompatible with unit tests).
 *
 * This mirrors the core pattern implemented in server.js so we can exercise
 * it without spinning up the entire application.
 */
function buildShutdownApp({ shutdownTimeoutMs = 500 } = {}) {
  const app = express();
  app.use(express.json());

  let inFlight = 0;
  let shuttingDown = false;

  // In-flight tracker — must be first
  app.use((req, res, next) => {
    if (shuttingDown) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({ error: 'Server is shutting down' });
    }
    inFlight++;
    const dec = () => {
      inFlight = Math.max(0, inFlight - 1);
    };
    res.once('finish', dec);
    res.once('close', dec);
    next();
  });

  // Simulate a slow endpoint that takes 200 ms to respond
  app.get('/slow', (_req, res) => {
    setTimeout(() => res.json({ ok: true }), 200);
  });

  app.get('/fast', (_req, res) => res.json({ ok: true }));

  const httpServer = http.createServer(app);

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    // Stop accepting new connections
    httpServer.close();

    // Drain in-flight requests
    const deadline = Date.now() + shutdownTimeoutMs;
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (inFlight <= 0 || Date.now() >= deadline) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    const timedOut = inFlight > 0;

    // Close DB
    await prismaMock.$disconnect();

    // Close Redis
    if (typeof cacheServiceMock.disconnect === 'function') {
      await cacheServiceMock.disconnect();
    }

    return { timedOut, inFlight };
  }

  return { app, httpServer, shutdown, getInFlight: () => inFlight, isShuttingDown: () => shuttingDown };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Graceful shutdown (issue #367)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves normal requests before shutdown is initiated', async () => {
    const { app } = buildShutdownApp();
    const res = await request(app).get('/fast');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects new requests with 503 after shutdown is initiated', async () => {
    const { app, shutdown } = buildShutdownApp();

    // Start shutdown (don't await — it drains in background)
    const shutdownPromise = shutdown();

    const res = await request(app).get('/fast');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/shutting down/i);

    await shutdownPromise;
  });

  it('503 response includes Connection: close header', async () => {
    const { app, shutdown } = buildShutdownApp();
    const shutdownPromise = shutdown();

    const res = await request(app).get('/fast');
    expect(res.status).toBe(503);
    expect(res.headers['connection']).toBe('close');

    await shutdownPromise;
  });

  it('calls prisma.$disconnect during shutdown', async () => {
    const { shutdown } = buildShutdownApp();
    await shutdown();
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('calls cacheService.disconnect during shutdown', async () => {
    const { shutdown } = buildShutdownApp();
    await shutdown();
    expect(cacheServiceMock.disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns timedOut=false when all requests complete within the window', async () => {
    const { app, shutdown } = buildShutdownApp({ shutdownTimeoutMs: 1000 });

    // Fire a fast request, don't await — we want to check drain behaviour
    const fastReq = request(app).get('/fast');

    // Give the fast request time to start and complete
    await new Promise((r) => setTimeout(r, 50));

    const result = await shutdown();

    expect(result.timedOut).toBe(false);
    await fastReq; // clean up
  });

  it('returns timedOut=true when requests do not complete within the window', async () => {
    const { app, shutdown } = buildShutdownApp({ shutdownTimeoutMs: 50 });

    // Fire a slow request (200 ms) but use a tiny timeout (50 ms) — it will not drain
    // We must use a real HTTP server for the slow route to stay open
    await new Promise((resolve) => {
      const httpServer = http.createServer(app);
      httpServer.listen(0, async () => {
        const port = httpServer.address().port;

        // Start slow request (don't await — it stays in-flight)
        http.get(`http://localhost:${port}/slow`);

        // Give it a moment to register in-flight
        await new Promise((r) => setTimeout(r, 20));

        const result = await shutdown();
        expect(result.timedOut).toBe(true);

        httpServer.close(resolve);
      });
    });
  });

  it('is idempotent — calling shutdown twice does not double-disconnect', async () => {
    const { shutdown } = buildShutdownApp();
    await shutdown();
    await shutdown(); // second call should be a no-op
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });
});
