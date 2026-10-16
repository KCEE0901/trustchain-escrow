// Manual mock for the 'redis' package.
import { jest } from '@jest/globals';

const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  expire: jest.fn().mockResolvedValue(1),
  sAdd: jest.fn().mockResolvedValue(1),
  sMembers: jest.fn().mockResolvedValue([]),
  sRem: jest.fn().mockResolvedValue(1),
  zAdd: jest.fn().mockResolvedValue(1),
  zRem: jest.fn().mockResolvedValue(1),
  zRangeByScore: jest.fn().mockResolvedValue([]),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  on: jest.fn(),
};

// Each createClient() call returns a fresh client so concurrency tests can
// assert per-connection behavior (e.g. overlapping workers) deterministically
// without shared mock state leaking between instances.
export const createClient = jest.fn(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  expire: jest.fn().mockResolvedValue(1),
  sAdd: jest.fn().mockResolvedValue(1),
  sMembers: jest.fn().mockResolvedValue([]),
  sRem: jest.fn().mockResolvedValue(1),
  zAdd: jest.fn().mockResolvedValue(1),
  zRem: jest.fn().mockResolvedValue(1),
  zRangeByScore: jest.fn().mockResolvedValue([]),
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  on: jest.fn(),
}));

export { mockClient };
