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
  scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
  on: jest.fn(),
  // Idempotency primitives used by the indexer sync-lag alert path.
  // `set` with NX/EX options returns 'OK' on first write and null when the
  // key already exists, mirroring real Redis semantics for SET NX.
  setNX: jest.fn().mockResolvedValue('OK'),
  eval: jest.fn().mockResolvedValue(1),
};

export const createClient = jest.fn(() => mockClient);
