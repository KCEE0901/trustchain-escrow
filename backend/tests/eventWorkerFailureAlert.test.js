import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('bullmq', () => ({ Worker: jest.fn() }));
jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  connection: {},
  stellarEventsQueue: {},
  deadLetterQueue: {},
  queueMetrics: {},
}));

const { configurePermanentFailureAlerter, processDeadLetterEvent } = await import(
  '../services/eventWorker.js'
);

const job = {
  data: {
    originalJob: { id: 'job-42', data: { ledger: 100 } },
    error: { message: 'contract invocation failed' },
    attemptsMade: 3,
  },
};

describe('event worker failure alerting', () => {
  beforeEach(() => {
    configurePermanentFailureAlerter(null);
  });

  it('alerts with sanitized permanent failure details', async () => {
    const alerter = jest.fn().mockResolvedValue({ status: 'delivered' });
    configurePermanentFailureAlerter(alerter);

    await processDeadLetterEvent(job);

    expect(alerter).toHaveBeenCalledWith({
      type: 'PERMANENT_EVENT_FAILURE',
      jobId: 'job-42',
      attemptsMade: 3,
      error: 'contract invocation failed',
    });
  });

  it('fails the job so BullMQ can retry when alerting fails', async () => {
    configurePermanentFailureAlerter(jest.fn().mockRejectedValue(new Error('alert unavailable')));

    await expect(processDeadLetterEvent(job)).rejects.toThrow('alert unavailable');
  });

  it('continues safely when alert delivery is disabled', async () => {
    await expect(processDeadLetterEvent(job)).resolves.toBeUndefined();
  });
});
