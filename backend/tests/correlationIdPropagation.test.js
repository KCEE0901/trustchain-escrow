/**
 * Correlation ID Propagation Tests
 *
 * Asserts the correlation id assigned to an HTTP request flows into queued
 * job payloads and back into the logging context when a worker runs the job.
 */

import { jest } from '@jest/globals';

const pollPendingTransactions = jest.fn();
jest.unstable_mockModule('../services/stellarMonitorService.js', () => ({
  pollPendingTransactions,
}));

const { assignRequestContext } = await import('../api/middleware/requestLogger.js');
const { getCorrelationId, runWithCorrelation } = await import('../config/logger.js');
const { enqueueEvent, getQueueSnapshot, __resetForTests } = await import('../queues/emailQueue.js');
const { enqueueWebhookDelivery } = await import('../queues/webhookQueue.js');
const { webhookQueue } = await import('../queues/index.js');
const { handleMonitorJob } = await import('../workers/stellarMonitorWorker.js');

const mockReqRes = (headers = {}) => ({
  req: { headers },
  res: { setHeader: jest.fn() },
});

/** Run a controller-like handler behind the request-context middleware. */
const runRequest = (headers, handler) =>
  new Promise((resolve, reject) => {
    const { req, res } = mockReqRes(headers);
    assignRequestContext(req, res, () => handler(req).then(resolve, reject));
  });

afterEach(() => {
  __resetForTests();
  webhookQueue.__resetForTests();
  jest.clearAllMocks();
});

describe('correlation id propagation', () => {
  it('carries the request correlation id from controller into email job payloads', async () => {
    await runRequest({ 'x-correlation-id': 'corr-email-1' }, () =>
      enqueueEvent('escrow.status_changed', { recipients: [] }),
    );

    const [job] = (await getQueueSnapshot()).queue;
    expect(job.data.correlationId).toBe('corr-email-1');
  });

  it('carries the correlation id into webhook delivery payloads', async () => {
    await runRequest({ 'x-correlation-id': 'corr-hook-1' }, () =>
      enqueueWebhookDelivery('d-1', 'https://example.test/hook', { ok: true }),
    );

    const [job] = await webhookQueue.getWaiting();
    expect(job.data.correlationId).toBe('corr-hook-1');
  });

  it('falls back to the request id when no correlation header is sent', async () => {
    await runRequest({ 'x-request-id': 'req-42' }, () =>
      enqueueEvent('dispute.raised', { recipients: [] }),
    );

    const [job] = (await getQueueSnapshot()).queue;
    expect(job.data.correlationId).toBe('req-42');
  });

  it('does not add a correlation id outside a request context', async () => {
    await enqueueEvent('milestone.completed', { recipients: [] });

    const [job] = (await getQueueSnapshot()).queue;
    expect(job.data).not.toHaveProperty('correlationId');
  });

  it('restores the correlation id in the worker context', async () => {
    let seen;
    pollPendingTransactions.mockImplementation(async () => {
      seen = getCorrelationId();
      return { checked: 0 };
    });

    await handleMonitorJob({ id: 'job-1', data: { correlationId: 'corr-worker-1' } });

    expect(seen).toBe('corr-worker-1');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('runs without a context when the job has no correlation id', async () => {
    expect(await runWithCorrelation(undefined, () => getCorrelationId())).toBeUndefined();
  });
});
