/**
 * Unit tests for backend/services/escrowService.js
 *
 * Covers: fundEscrow, releaseMilestone, raiseDispute, resolveDispute
 *
 * All Prisma interactions are mocked via jest.unstable_mockModule so no
 * database or Stellar node is required.
 */

import { jest } from '@jest/globals';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const escrowMock = {
  create: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  update: jest.fn(),
};
const milestoneMock = {
  update: jest.fn(),
  updateMany: jest.fn(),
};
const disputeMock = {
  create: jest.fn(),
  update: jest.fn(),
};
const adminAuditLogMock = {
  create: jest.fn(),
};

/**
 * The Prisma $transaction mock executes the callback with a tx proxy that
 * delegates to the same per-model mocks, mirroring withTransaction's real
 * behaviour.
 */
const txProxy = {
  escrow: escrowMock,
  milestone: milestoneMock,
  dispute: disputeMock,
  adminAuditLog: adminAuditLogMock,
};

const prismaMock = {
  $transaction: jest.fn((fn) => fn(txProxy)),
  escrow: escrowMock,
  milestone: milestoneMock,
  dispute: disputeMock,
  adminAuditLog: adminAuditLogMock,
};

jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));

// withTransaction just calls prisma.$transaction, so mocking prisma is enough.
jest.unstable_mockModule('../../lib/transaction.js', () => ({
  withTransaction: jest.fn((fn, _opts) => prismaMock.$transaction(fn)),
  withRetry: jest.fn((fn) => fn()),
  isDeadlock: jest.fn(() => false),
}));

// ── Import SUT after mocks are registered ────────────────────────────────────

const { fundEscrow, releaseMilestone, raiseDispute, resolveDispute } = await import(
  '../../services/escrowService.js'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetMocks() {
  for (const mock of [
    escrowMock.create,
    escrowMock.findUniqueOrThrow,
    escrowMock.update,
    milestoneMock.update,
    milestoneMock.updateMany,
    disputeMock.create,
    disputeMock.update,
    adminAuditLogMock.create,
    prismaMock.$transaction,
  ]) {
    mock.mockReset();
  }
  // Restore default $transaction behaviour after reset
  prismaMock.$transaction.mockImplementation((fn) => fn(txProxy));
}

// ── fundEscrow ────────────────────────────────────────────────────────────────

describe('fundEscrow', () => {
  beforeEach(resetMocks);

  test('creates an escrow record with the provided data', async () => {
    const escrowData = {
      id: '1001',
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREELANCER',
      tokenAddress: 'GTOKEN',
      totalAmount: '5000',
      briefHash: 'Qmhash123',
      createdLedger: 42,
    };

    const expectedEscrow = {
      id: BigInt(escrowData.id),
      status: 'Active',
      remainingBalance: escrowData.totalAmount,
    };

    escrowMock.create.mockResolvedValue(expectedEscrow);
    adminAuditLogMock.create.mockResolvedValue({});

    const result = await fundEscrow(escrowData);

    expect(escrowMock.create).toHaveBeenCalledTimes(1);
    expect(escrowMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientAddress: 'GCLIENT',
          freelancerAddress: 'GFREELANCER',
          status: 'Active',
          totalAmount: '5000',
          remainingBalance: '5000',
        }),
      }),
    );
    expect(result).toEqual(expectedEscrow);
  });

  test('writes an ESCROW_FUNDED audit log entry', async () => {
    const escrowData = {
      id: '1002',
      clientAddress: 'GCLIENT2',
      freelancerAddress: 'GFREELANCER2',
      tokenAddress: 'GTOKEN',
      totalAmount: '1000',
      briefHash: 'QmHash',
    };

    escrowMock.create.mockResolvedValue({ id: BigInt(escrowData.id) });
    adminAuditLogMock.create.mockResolvedValue({});

    await fundEscrow(escrowData);

    expect(adminAuditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ESCROW_FUNDED',
          performedBy: 'GCLIENT2',
        }),
      }),
    );
  });

  test('sets arbiterAddress to null when not provided', async () => {
    escrowMock.create.mockResolvedValue({ id: 1n });
    adminAuditLogMock.create.mockResolvedValue({});

    await fundEscrow({
      id: '1003',
      clientAddress: 'GA',
      freelancerAddress: 'GB',
      tokenAddress: 'GT',
      totalAmount: '500',
      briefHash: 'Qm',
    });

    expect(escrowMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ arbiterAddress: null }),
      }),
    );
  });

  test('propagates Prisma errors', async () => {
    escrowMock.create.mockRejectedValue(new Error('DB connection failed'));

    await expect(
      fundEscrow({
        id: '1004',
        clientAddress: 'GA',
        freelancerAddress: 'GB',
        tokenAddress: 'GT',
        totalAmount: '100',
        briefHash: 'Qm',
      }),
    ).rejects.toThrow('DB connection failed');
  });
});

// ── releaseMilestone ──────────────────────────────────────────────────────────

describe('releaseMilestone', () => {
  beforeEach(resetMocks);

  test('releases a milestone and updates the remaining balance', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      remainingBalance: '3000',
      status: 'Active',
    });
    milestoneMock.update.mockResolvedValue({ milestoneIndex: 0, status: 'Approved' });
    escrowMock.update.mockResolvedValue({ remainingBalance: '2000', status: 'Active' });
    adminAuditLogMock.create.mockResolvedValue({});

    const result = await releaseMilestone({
      escrowId: '1001',
      milestoneIndex: 0,
      amount: '1000',
      callerAddress: 'GCLIENT',
    });

    expect(milestoneMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Approved' }),
      }),
    );
    expect(escrowMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remainingBalance: '2000' }),
      }),
    );
    expect(result.milestone.status).toBe('Approved');
  });

  test('marks escrow as Completed when the final milestone is released', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      remainingBalance: '1000',
      status: 'Active',
    });
    milestoneMock.update.mockResolvedValue({ milestoneIndex: 1, status: 'Approved' });
    escrowMock.update.mockResolvedValue({ remainingBalance: '0', status: 'Completed' });
    adminAuditLogMock.create.mockResolvedValue({});

    await releaseMilestone({
      escrowId: '2001',
      milestoneIndex: 1,
      amount: '1000',
      callerAddress: 'GCLIENT',
    });

    expect(escrowMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Completed', remainingBalance: '0' }),
      }),
    );
  });

  test('throws 409 when escrow is not Active', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      remainingBalance: '1000',
      status: 'Disputed',
    });

    await expect(
      releaseMilestone({
        escrowId: '1001',
        milestoneIndex: 0,
        amount: '500',
        callerAddress: 'GCLIENT',
      }),
    ).rejects.toMatchObject({ message: 'Escrow is not active', statusCode: 409 });
  });

  test('throws 422 when release amount exceeds remaining balance', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      remainingBalance: '100',
      status: 'Active',
    });

    await expect(
      releaseMilestone({
        escrowId: '1001',
        milestoneIndex: 0,
        amount: '9999',
        callerAddress: 'GCLIENT',
      }),
    ).rejects.toMatchObject({ message: 'Insufficient escrow balance', statusCode: 422 });
  });

  test('writes a MILESTONE_RELEASED audit log entry', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({ remainingBalance: '2000', status: 'Active' });
    milestoneMock.update.mockResolvedValue({ status: 'Approved' });
    escrowMock.update.mockResolvedValue({ remainingBalance: '1000', status: 'Active' });
    adminAuditLogMock.create.mockResolvedValue({});

    await releaseMilestone({
      escrowId: '3001',
      milestoneIndex: 0,
      amount: '1000',
      callerAddress: 'GFREELANCER',
    });

    expect(adminAuditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MILESTONE_RELEASED' }),
      }),
    );
  });
});

// ── raiseDispute ──────────────────────────────────────────────────────────────

describe('raiseDispute', () => {
  beforeEach(resetMocks);

  test('transitions escrow to Disputed and creates a dispute record', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({ status: 'Active' });
    escrowMock.update.mockResolvedValue({ status: 'Disputed' });
    disputeMock.create.mockResolvedValue({ id: 1, escrowId: BigInt('4001') });
    adminAuditLogMock.create.mockResolvedValue({});

    const result = await raiseDispute({
      escrowId: '4001',
      raisedByAddress: 'GCLIENT',
    });

    expect(escrowMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Disputed' } }),
    );
    expect(disputeMock.create).toHaveBeenCalledTimes(1);
    expect(result.escrow.status).toBe('Disputed');
  });

  test('throws 409 when escrow is not Active', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({ status: 'Completed' });

    await expect(
      raiseDispute({ escrowId: '4002', raisedByAddress: 'GCLIENT' }),
    ).rejects.toMatchObject({
      message: 'Escrow must be Active to raise a dispute',
      statusCode: 409,
    });
  });

  test('rejects the specified milestone when milestoneIndex is provided', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({ status: 'Active' });
    escrowMock.update.mockResolvedValue({ status: 'Disputed' });
    disputeMock.create.mockResolvedValue({ id: 2 });
    milestoneMock.updateMany.mockResolvedValue({ count: 1 });
    adminAuditLogMock.create.mockResolvedValue({});

    await raiseDispute({
      escrowId: '4003',
      raisedByAddress: 'GCLIENT',
      milestoneIndex: 1,
    });

    expect(milestoneMock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'Rejected' },
      }),
    );
  });

  test('writes a DISPUTE_RAISED audit log entry', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({ status: 'Active' });
    escrowMock.update.mockResolvedValue({ status: 'Disputed' });
    disputeMock.create.mockResolvedValue({ id: 3 });
    adminAuditLogMock.create.mockResolvedValue({});

    await raiseDispute({ escrowId: '4004', raisedByAddress: 'GFREELANCER' });

    expect(adminAuditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DISPUTE_RAISED' }),
      }),
    );
  });
});

// ── resolveDispute ────────────────────────────────────────────────────────────

describe('resolveDispute', () => {
  beforeEach(resetMocks);

  test('resolves dispute and marks escrow as Completed', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      status: 'Disputed',
      remainingBalance: '3000',
    });
    escrowMock.update.mockResolvedValue({ status: 'Completed', remainingBalance: '0' });
    disputeMock.update.mockResolvedValue({
      resolvedAt: new Date(),
      clientAmount: '1000',
      freelancerAmount: '2000',
    });
    adminAuditLogMock.create.mockResolvedValue({});

    const result = await resolveDispute({
      escrowId: '5001',
      clientAmount: '1000',
      freelancerAmount: '2000',
      resolvedBy: 'GARBITER',
      resolution: 'Favour freelancer',
    });

    expect(escrowMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Completed', remainingBalance: '0' }),
      }),
    );
    expect(result.dispute.clientAmount).toBe('1000');
  });

  test('throws 409 when escrow is not in Disputed state', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      status: 'Active',
      remainingBalance: '3000',
    });

    await expect(
      resolveDispute({
        escrowId: '5002',
        clientAmount: '1500',
        freelancerAmount: '1500',
        resolvedBy: 'GARBITER',
      }),
    ).rejects.toMatchObject({ message: 'Escrow is not in Disputed state', statusCode: 409 });
  });

  test('throws 422 when amounts do not sum to remaining balance', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      status: 'Disputed',
      remainingBalance: '3000',
    });

    await expect(
      resolveDispute({
        escrowId: '5003',
        clientAmount: '1000',
        freelancerAmount: '500', // 1500 ≠ 3000
        resolvedBy: 'GARBITER',
      }),
    ).rejects.toMatchObject({
      message: 'Amounts must sum to remaining balance',
      statusCode: 422,
    });
  });

  test('writes a DISPUTE_RESOLVED audit log entry', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      status: 'Disputed',
      remainingBalance: '2000',
    });
    escrowMock.update.mockResolvedValue({ status: 'Completed' });
    disputeMock.update.mockResolvedValue({ resolvedAt: new Date() });
    adminAuditLogMock.create.mockResolvedValue({});

    await resolveDispute({
      escrowId: '5004',
      clientAmount: '1000',
      freelancerAmount: '1000',
      resolvedBy: 'GARBITER',
      resolution: 'Split equally',
    });

    expect(adminAuditLogMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DISPUTE_RESOLVED' }),
      }),
    );
  });

  test('stores the resolution text on the dispute record', async () => {
    escrowMock.findUniqueOrThrow.mockResolvedValue({
      status: 'Disputed',
      remainingBalance: '4000',
    });
    escrowMock.update.mockResolvedValue({ status: 'Completed' });
    disputeMock.update.mockResolvedValue({ resolution: 'favour client' });
    adminAuditLogMock.create.mockResolvedValue({});

    await resolveDispute({
      escrowId: '5005',
      clientAmount: '4000',
      freelancerAmount: '0',
      resolvedBy: 'GARBITER',
      resolution: 'favour client',
    });

    expect(disputeMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolution: 'favour client' }),
      }),
    );
  });
});
