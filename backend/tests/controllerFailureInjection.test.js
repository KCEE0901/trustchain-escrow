import { invokeDependency } from '../lib/failureInjection.js';

test.each(['tenant cache', 'payment replay store', 'incident notification'])('%s retries transient failures', async () => {
  const dependency = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ ok: true });
  await expect(invokeDependency(dependency)).resolves.toEqual({ ok: true });
  expect(dependency).toHaveBeenCalledTimes(2);
});

test('malformed responses fail without retrying', async () => {
  const dependency = jest.fn().mockResolvedValue({});
  await expect(invokeDependency(dependency, { retries: 3, validate: (value) => value.ok === true })).rejects.toThrow(/Malformed/);
  expect(dependency).toHaveBeenCalledTimes(1);
});

test('terminal dependency failure remains deterministic', async () => {
  const dependency = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(invokeDependency(dependency, { retries: 1 })).rejects.toThrow('offline');
  expect(dependency).toHaveBeenCalledTimes(2);
});
