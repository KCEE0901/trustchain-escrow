import { jest } from '@jest/globals';

/**
 * fraudDetector.js scores completed escrows via `prisma` lookups (sessions,
 * repeated-pair history, milestone count) — it does not use Redis at all, so
 * this mocks `../lib/prisma.js` (the module it actually imports) rather than
 * a cache layer.
 */
const prismaMock = {
  session: { findFirst: jest.fn() },
  escrow: { count: jest.fn(), findUnique: jest.fn() },
  milestone: { count: jest.fn() },
  adminAuditLog: { create: jest.fn(), findFirst: jest.fn() },
};

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: prismaMock,
}));

const { scoreEscrow, runFraudCheck, isReputationSuspended } = await import(
  '../services/fraudDetector.js'
);

function baseEscrow(overrides = {}) {
  const now = new Date('2024-01-01T12:00:00Z');
  return {
    id: 1n,
    clientAddress: 'GCLIENT',
    freelancerAddress: 'GFREELANCER',
    totalAmount: '1234567', // not divisible by 1_000_000 -> no ROUND_AMOUNT signal
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2h before updatedAt
    updatedAt: now,
    ...overrides,
  };
}

/** No session rows at all -> checkSameIp's optional chaining short-circuits to false. */
function mockNoFraudSignals() {
  prismaMock.session.findFirst.mockResolvedValue(null);
  prismaMock.escrow.count.mockResolvedValue(0);
  prismaMock.milestone.count.mockResolvedValue(1); // has milestones -> no ZERO_MILESTONES signal
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('scoreEscrow', () => {
  it('gives a low (zero) score and does not flag an escrow with no fraud signals', async () => {
    mockNoFraudSignals();

    const result = await scoreEscrow(baseEscrow());

    expect(result.score).toBe(0);
    expect(result.signals).toEqual([]);
    expect(result.flagged).toBe(false);
  });

  it('raises the score and adds SAME_IP when client and freelancer share their last-known IP', async () => {
    mockNoFraudSignals();
    prismaMock.session.findFirst
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' }) // client
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' }); // freelancer, same IP

    const result = await scoreEscrow(baseEscrow());

    expect(result.signals).toContain('SAME_IP');
    expect(result.score).toBe(40); // W.sameIp default
    expect(result.flagged).toBe(false); // below default threshold of 50
  });

  it('does not add SAME_IP when the two parties have different last-known IPs', async () => {
    mockNoFraudSignals();
    prismaMock.session.findFirst
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' })
      .mockResolvedValueOnce({ ipAddress: '10.0.0.2' });

    const result = await scoreEscrow(baseEscrow());

    expect(result.signals).not.toContain('SAME_IP');
    expect(result.score).toBe(0);
  });

  it('adds RAPID_COMPLETION when the escrow completed in under the configured window', async () => {
    mockNoFraudSignals();

    const now = new Date('2024-01-01T12:00:00Z');
    const result = await scoreEscrow(
      baseEscrow({
        createdAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes before
        updatedAt: now,
      }),
    );

    expect(result.signals).toContain('RAPID_COMPLETION');
    expect(result.score).toBe(20); // W.rapidCompletion default
  });

  it('adds REPEATED_PAIR when the same client/freelancer pair has 3+ prior completions', async () => {
    mockNoFraudSignals();
    prismaMock.escrow.count.mockResolvedValue(3);

    const result = await scoreEscrow(baseEscrow());

    expect(result.signals).toContain('REPEATED_PAIR');
    expect(result.score).toBe(25); // W.repeatedPair default
  });

  it('adds ROUND_AMOUNT when totalAmount is a multiple of 1,000,000 stroops', async () => {
    mockNoFraudSignals();

    const result = await scoreEscrow(baseEscrow({ totalAmount: '5000000' }));

    expect(result.signals).toContain('ROUND_AMOUNT');
    expect(result.score).toBe(10); // W.roundAmount default
  });

  it('adds ZERO_MILESTONES when the escrow has no milestones defined', async () => {
    prismaMock.session.findFirst.mockResolvedValue(null);
    prismaMock.escrow.count.mockResolvedValue(0);
    prismaMock.milestone.count.mockResolvedValue(0);

    const result = await scoreEscrow(baseEscrow());

    expect(result.signals).toContain('ZERO_MILESTONES');
    expect(result.score).toBe(5); // W.zeroMilestones default
  });

  it('flags the escrow once the combined signal score reaches the threshold', async () => {
    // SAME_IP (40) + RAPID_COMPLETION (20) = 60, over the default threshold of 50.
    prismaMock.session.findFirst
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' })
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' });
    prismaMock.escrow.count.mockResolvedValue(0);
    prismaMock.milestone.count.mockResolvedValue(1);

    const now = new Date('2024-01-01T12:00:00Z');
    const result = await scoreEscrow(
      baseEscrow({
        createdAt: new Date(now.getTime() - 5 * 60 * 1000),
        updatedAt: now,
      }),
    );

    expect(result.score).toBe(60);
    expect(result.signals).toEqual(expect.arrayContaining(['SAME_IP', 'RAPID_COMPLETION']));
    expect(result.flagged).toBe(true);
  });

  it('does not flag when the combined score stays below the threshold', async () => {
    // REPEATED_PAIR (25) + ROUND_AMOUNT (10) = 35, under the default threshold of 50.
    prismaMock.session.findFirst.mockResolvedValue(null);
    prismaMock.escrow.count.mockResolvedValue(3);
    prismaMock.milestone.count.mockResolvedValue(1);

    const result = await scoreEscrow(baseEscrow({ totalAmount: '2000000' }));

    expect(result.score).toBe(35);
    expect(result.flagged).toBe(false);
  });

  it('treats a failed same-IP lookup as no signal rather than throwing', async () => {
    prismaMock.session.findFirst.mockRejectedValue(new Error('db unavailable'));
    prismaMock.escrow.count.mockResolvedValue(0);
    prismaMock.milestone.count.mockResolvedValue(1);

    const result = await scoreEscrow(baseEscrow());

    expect(result.signals).not.toContain('SAME_IP');
    expect(result.score).toBe(0);
  });
});

describe('runFraudCheck', () => {
  it('throws when the escrow does not exist', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(null);

    await expect(runFraudCheck('999')).rejects.toThrow('Escrow 999 not found');
  });

  it('records FRAUD_FLAGGED and suspends both parties when the escrow is flagged', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(baseEscrow());
    prismaMock.session.findFirst
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' })
      .mockResolvedValueOnce({ ipAddress: '10.0.0.1' });
    prismaMock.escrow.count.mockResolvedValue(3); // + REPEATED_PAIR -> well over threshold
    prismaMock.milestone.count.mockResolvedValue(1);
    prismaMock.adminAuditLog.create.mockResolvedValue({});

    const result = await runFraudCheck('1');

    expect(result.flagged).toBe(true);
    expect(prismaMock.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FRAUD_FLAGGED' }),
      }),
    );
    const suspendedCalls = prismaMock.adminAuditLog.create.mock.calls.filter(
      ([arg]) => arg.data.action === 'REPUTATION_SUSPENDED',
    );
    expect(suspendedCalls).toHaveLength(2);
  });

  it('does not touch the audit log when the escrow is not flagged', async () => {
    prismaMock.escrow.findUnique.mockResolvedValue(baseEscrow());
    prismaMock.session.findFirst.mockResolvedValue(null);
    prismaMock.escrow.count.mockResolvedValue(0);
    prismaMock.milestone.count.mockResolvedValue(1);

    const result = await runFraudCheck('1');

    expect(result.flagged).toBe(false);
    expect(prismaMock.adminAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('isReputationSuspended', () => {
  it('returns true when the most recent action for the address is REPUTATION_SUSPENDED', async () => {
    prismaMock.adminAuditLog.findFirst.mockResolvedValue({ action: 'REPUTATION_SUSPENDED' });

    await expect(isReputationSuspended('GADDRESS')).resolves.toBe(true);
  });

  it('returns false when the most recent action is REPUTATION_RESTORED', async () => {
    prismaMock.adminAuditLog.findFirst.mockResolvedValue({ action: 'REPUTATION_RESTORED' });

    await expect(isReputationSuspended('GADDRESS')).resolves.toBe(false);
  });

  it('returns false when there is no suspension history at all', async () => {
    prismaMock.adminAuditLog.findFirst.mockResolvedValue(null);

    await expect(isReputationSuspended('GADDRESS')).resolves.toBe(false);
  });

  it('returns false rather than throwing when the lookup fails', async () => {
    prismaMock.adminAuditLog.findFirst.mockRejectedValue(new Error('db unavailable'));

    await expect(isReputationSuspended('GADDRESS')).resolves.toBe(false);
  });
});
