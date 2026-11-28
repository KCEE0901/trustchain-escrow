import { jest } from '@jest/globals';

jest.unstable_mockModule('bullmq', () => ({ Worker: jest.fn() }));
jest.unstable_mockModule('../queues/index.js', () => ({ connection: {} }));

const { sendWithProvider } = await import('../workers/emailWorker.js');

const message = {
  to: { email: 'user@example.com', name: 'User' },
  subject: 'Subject',
  text: 'text',
  html: '<p>html</p>',
};

const baseConfig = {
  provider: 'sendgrid',
  sendgridApiKey: 'SG.key',
  fromEmail: 'no-reply@example.com',
  fromName: 'Test',
  fallbackProvider: 'none',
};

describe('emailWorker provider fallback', () => {
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers via the primary provider and logs it', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'msg-1' },
    });
    const result = await sendWithProvider(message, 'dispute.raised', baseConfig);
    expect(result).toEqual({ provider: 'sendgrid', messageId: 'msg-1' });
    expect(logSpy).toHaveBeenCalledWith('[EmailWorker] Delivered via primary provider: sendgrid');
  });

  it('falls back to console when the primary fails and fallback is enabled', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await sendWithProvider(message, 'dispute.raised', {
      ...baseConfig,
      fallbackProvider: 'console',
    });
    expect(result.provider).toBe('console');
    expect(result.fallback).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('[EmailWorker] Delivered via fallback provider: console');
  });

  it('rethrows the primary failure when fallback is disabled', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    });
    await expect(sendWithProvider(message, 'dispute.raised', baseConfig)).rejects.toThrow(
      'SendGrid failed: 503 unavailable',
    );
  });
});
