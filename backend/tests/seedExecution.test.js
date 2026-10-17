import { describe, expect, it, jest } from '@jest/globals';
import { seed } from '../../scripts/seed.js';

const options = { isDryRun: false, forceReseed: false, extraCount: 0 };

function createDatabase({ existingCount = 0, countError } = {}) {
  const transaction = {
    dispute: { deleteMany: jest.fn() },
    milestone: { deleteMany: jest.fn(), upsert: jest.fn() },
    escrow: { deleteMany: jest.fn(), upsert: jest.fn() },
    reputationRecord: { deleteMany: jest.fn(), upsert: jest.fn() },
  };
  return {
    escrow: {
      count: countError
        ? jest.fn().mockRejectedValue(countError)
        : jest.fn().mockResolvedValue(existingCount),
    },
    $transaction: jest.fn(async (callback) => callback(transaction)),
    transaction,
  };
}

function createLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('seed execution safeguards', () => {
  it('emits structured telemetry for a successful seed', async () => {
    const database = createDatabase();
    const logger = createLogger();

    await expect(seed({ database, options, logger, now: () => 10 })).resolves.toEqual({
      status: 'success',
    });
    const events = logger.log.mock.calls
      .map(([message]) => message)
      .filter((message) => message.startsWith('{'))
      .map(JSON.parse);
    expect(events.map(({ event }) => event)).toEqual(['seed_started', 'seed_completed']);
  });

  it('skips an existing dataset without opening a transaction', async () => {
    const database = createDatabase({ existingCount: 3 });

    await expect(seed({ database, options, logger: createLogger() })).resolves.toEqual({
      status: 'skipped',
      reason: 'existing_data',
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('joins concurrent callers to one seed transaction', async () => {
    const database = createDatabase();
    let releaseCount;
    database.escrow.count.mockImplementation(
      () => new Promise((resolve) => (releaseCount = () => resolve(0))),
    );

    const firstRun = seed({ database, options, logger: createLogger() });
    const secondRun = seed({ database, options, logger: createLogger() });
    expect(secondRun).toBe(firstRun);

    releaseCount();
    await firstRun;
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('degrades safely when no database adapter is available', async () => {
    await expect(seed({ options, logger: createLogger() })).resolves.toEqual({
      status: 'degraded',
      reason: 'database_adapter_unavailable',
    });
  });

  it('degrades safely when the database cannot be reached', async () => {
    const connectionError = Object.assign(new Error('connection details'), {
      code: 'ECONNREFUSED',
    });

    await expect(
      seed({
        database: createDatabase({ countError: connectionError }),
        options,
        logger: createLogger(),
      }),
    ).resolves.toEqual({ status: 'degraded', reason: 'database_unavailable' });
  });

  it('propagates non-recoverable transaction failures', async () => {
    const database = createDatabase();
    database.$transaction.mockRejectedValue(new Error('constraint violation'));

    await expect(seed({ database, options, logger: createLogger() })).rejects.toThrow(
      'constraint violation',
    );
  });
});
