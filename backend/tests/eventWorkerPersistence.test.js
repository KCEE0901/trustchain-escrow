import {
  configureEventWorkerPersistence,
  logPermanentFailure,
  updateLastProcessedLedger,
} from '../services/eventWorker.js';

describe('event worker persistence failures', () => {
  it('surfaces ledger persistence failures', async () => {
    configureEventWorkerPersistence({ saveLedger: async () => { throw new Error('db unavailable'); } });
    await expect(updateLastProcessedLedger(42)).rejects.toThrow('db unavailable');
  });

  it('surfaces permanent-failure persistence errors', async () => {
    configureEventWorkerPersistence({ saveFailure: async () => { throw new Error('write rejected'); } });
    await expect(logPermanentFailure({ id: 'job-1' }, new Error('event failed'), 3))
      .rejects.toThrow('write rejected');
  });
});
