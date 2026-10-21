import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
const waiting = jest.fn();
const info = jest.fn();
const counts = jest.fn();
const getActive = jest.fn();
const getCompleted = jest.fn();
const getFailed = jest.fn();
const metrics = { totalJobs: 2, completedJobs: 1, failedJobs: 1, retryCount: 0, deadLetterCount: 0,
  getFailureRate: () => 2, getSuccessRate: () => 98, getProcessingTime: () => 4 };
const main = { getJobCounts: counts, getWaiting: waiting, getActive,
  getCompleted, getFailed };
const dead = { getJobCounts: counts, getWaiting: waiting, getActive };
jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  stellarEventsQueue: main, deadLetterQueue: dead, queueMetrics: metrics,
  connection: { info, status: 'ready' },
}));
const { default: router, queueHealthTelemetry } = await import('../api/routes/queueDashboardRoutes.js');
const app = express();
app.use('/admin/queues', router);
const validInfo = 'redis_version:7.2.0\nused_memory_human:1M\nconnected_clients:2\n';

beforeEach(() => {
  for (const fn of [waiting, info, counts, getActive, getCompleted, getFailed]) fn.mockReset();
  waiting.mockResolvedValue([]);
  counts.mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 });
  getActive.mockResolvedValue([]); getCompleted.mockResolvedValue([]); getFailed.mockResolvedValue([]);
  info.mockResolvedValue(validInfo);
});
afterEach(() => jest.restoreAllMocks());

describe('queue stats failure injection and telemetry (#446 #447)', () => {
  test('reports success without adding secrets to logs', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    const response = await request(app).get('/admin/queues/stats').set('x-correlation-id', 'trace-123');
    expect(response.statusCode).toBe(200);
    expect(response.body.redis.version).toBe('7.2.0');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"correlationId":"trace-123"'));
    expect(queueHealthTelemetry()).toMatchObject({ attempts: expect.any(Number) });
  });
  test('retries a connection failure and succeeds', async () => {
    info.mockRejectedValueOnce(Object.assign(new Error('connection key=private'), { code: 'ECONNRESET' }));
    const response = await request(app).get('/admin/queues/stats');
    expect(response.statusCode).toBe(200);
    expect(info).toHaveBeenCalledTimes(2);
  });
  test('returns sanitized error for invalid redis INFO response without retry', async () => {
    info.mockResolvedValue({ password: 'not-redis-info' });
    const response = await request(app).get('/admin/queues/stats');
    expect(response.statusCode).toBe(503);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain('not-redis-info');
  });
  test('bounded retry stops after repeated dependency failures', async () => {
    info.mockRejectedValue(Object.assign(new Error('token=hidden'), { code: 'ECONNREFUSED' }));
    const response = await request(app).get('/admin/queues/stats');
    expect(response.statusCode).toBe(503);
    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(response.body)).not.toContain('hidden');
  });
  test('times out a never-settling dependency and terminates', async () => {
    info.mockImplementation(() => new Promise(() => {}));
    // The timeout is deliberately low and configurable for this deterministic test.
    process.env.QUEUE_HEALTH_TIMEOUT_MS = '50';
    try {
      const response = await request(app).get('/admin/queues/stats');
      expect(response.statusCode).toBe(503);
    } finally { delete process.env.QUEUE_HEALTH_TIMEOUT_MS; }
  });
});
