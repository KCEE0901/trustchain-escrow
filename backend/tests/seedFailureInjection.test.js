import { describe, expect, it, jest } from '@jest/globals';
import { seed } from '../../scripts/seed.js';

describe('seed failure injection', () => {
  it('executes the configured seed writer', async () => {
    const executeSeedData = jest.fn().mockResolvedValue(undefined);

    await seed({ executeSeedData });

    expect(executeSeedData).toHaveBeenCalledTimes(1);
  });

  it('propagates database failures to the caller', async () => {
    const executeSeedData = jest.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(seed({ executeSeedData })).rejects.toThrow('database unavailable');
  });

  it('propagates partial-write failures instead of reporting success', async () => {
    const executeSeedData = jest.fn().mockImplementation(async () => {
      throw new Error('transaction rolled back');
    });

    await expect(seed({ executeSeedData })).rejects.toThrow('transaction rolled back');
  });
});
