import { BoundedRetentionStore, createSingleFlight, gracefullyDegrade } from '../lib/operationalControls.js';

test('single-flight coalesces concurrent export delivery', async () => {
  const run = createSingleFlight();
  let calls = 0;
  const work = () => { calls += 1; return { jobId: 'job-1' }; };
  const [first, second] = await Promise.all([run('tenant:address', work), run('tenant:address', work)]);
  expect(first).toEqual(second);
  expect(calls).toBe(1);
});

test('degraded delivery is stable when optional infrastructure fails', async () => {
  await expect(gracefullyDegrade(() => Promise.reject(new Error('queue unavailable')), { status: 'unavailable' }))
    .resolves.toEqual({ status: 'unavailable' });
});

test('retention evicts oldest tenant resolution records', () => {
  const store = new BoundedRetentionStore(2);
  store.set('first', 1); store.set('second', 2); store.set('third', 3);
  expect(store.get('first')).toBeUndefined();
  expect(store.get('second')).toBe(2);
  expect(() => new BoundedRetentionStore(0)).toThrow(/positive integer/);
});
