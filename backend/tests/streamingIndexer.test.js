import { jest } from '@jest/globals';

const prismaMock = {
  paymentStream: { upsert: jest.fn(), updateMany: jest.fn() },
};
jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const { handleStreamCreated, handleStreamWithdrawn, resolveStreamStatus } = await import(
  '../services/streamingIndexer.js'
);

describe('streamingIndexer service — null/undefined handling', () => {
  beforeEach(() => jest.clearAllMocks());

  // Regression: a truthy check (`if (!streamId)`) previously skipped stream id 0,
  // which is a valid id, not a missing value.
  it('processes a stream_created event whose streamId is 0', async () => {
    await handleStreamCreated({ topic: ['stream_created', '0'], data: { sender: 'GABC' } });
    expect(prismaMock.paymentStream.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BigInt(0) } }),
    );
  });

  it('skips a stream_created event with a genuinely missing streamId', async () => {
    await handleStreamCreated({ topic: ['stream_created'], data: { sender: 'GABC' } });
    expect(prismaMock.paymentStream.upsert).not.toHaveBeenCalled();
  });

  // Regression: a withdrawal of amount 0 was previously dropped because `amount`
  // was checked with `if (!amount)` instead of `== null`.
  it('processes a stream_withdrawn event whose amount is 0', async () => {
    await handleStreamWithdrawn({ topic: ['stream_withdrawn', '5'], data: { amount: 0 } });
    expect(prismaMock.paymentStream.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastWithdrawnAmount: 0 }) }),
    );
  });

  it('resolves an empty-string status as-is, not as Unknown', () => {
    expect(resolveStreamStatus({ status: '' })).toBe('');
    expect(resolveStreamStatus({ status: null })).toBe('Unknown');
    expect(resolveStreamStatus({})).toBe('Unknown');
  });
});
