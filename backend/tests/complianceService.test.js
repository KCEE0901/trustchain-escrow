import { jest } from '@jest/globals';

const prismaMock = {
  payment: { findMany: jest.fn(), count: jest.fn() },
  escrow: { findMany: jest.fn(), count: jest.fn() },
  contractEvent: { findMany: jest.fn(), count: jest.fn() },
  user: { findMany: jest.fn(), count: jest.fn() },
  kycVerification: { findMany: jest.fn(), count: jest.fn() },
  userProfile: { findMany: jest.fn() },
  reputationRecord: { findMany: jest.fn() },
  auditLog: { findMany: jest.fn(), count: jest.fn() },
  adminAuditLog: { findMany: jest.fn() },
};

const auditServiceMock = {
  search: jest.fn(),
  log: jest.fn(),
};

jest.unstable_mockModule('../lib/prisma.js', () => ({
  default: prismaMock,
}));

jest.unstable_mockModule('../services/auditService.js', () => ({
  AuditAction: {
    REPORT_GENERATED: 'REPORT_GENERATED',
    REPORT_EXPORTED: 'REPORT_EXPORTED',
    REPORT_SCHEDULED: 'REPORT_SCHEDULED',
    REPORT_SCHEDULED_RUN: 'REPORT_SCHEDULED_RUN',
    REPORT_SCHEDULE_DISABLED: 'REPORT_SCHEDULE_DISABLED',
  },
  AuditCategory: {
    REPORTING: 'REPORTING',
    PAYMENT: 'PAYMENT',
    KYC: 'KYC',
  },
  default: auditServiceMock,
}));

const {
  __resetForTests,
  createSchedule,
  disableSchedule,
  estimateResultSize,
  exportReport,
  generateReport,
  getExportJob,
  getExportJobResult,
  listSchedules,
  processDueSchedules,
  startExportJob,
  validateFilters,
} = await import('../services/complianceService.js');

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();

  prismaMock.payment.findMany.mockResolvedValue([
    {
      id: 'pay_1',
      address: 'GABC123',
      escrowId: 42n,
      amountFiat: 1500,
      amountCrypto: '25.0',
      currency: 'usd',
      status: 'Completed',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T01:00:00Z'),
    },
  ]);
  prismaMock.escrow.findMany.mockResolvedValue([
    {
      id: 42n,
      clientAddress: 'GCLIENT',
      freelancerAddress: 'GFREELANCER',
      tokenAddress: 'TOKEN',
      totalAmount: '2500',
      remainingBalance: '1000',
      status: 'Active',
      milestones: [{ id: 1 }],
      dispute: null,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    },
  ]);
  prismaMock.contractEvent.findMany.mockResolvedValue([
    {
      id: 7,
      eventType: 'esc_crt',
      escrowId: 42n,
      txHash: 'abc',
      ledger: 1200n,
      ledgerAt: new Date('2026-03-01T00:05:00Z'),
    },
  ]);
  prismaMock.user.findMany.mockResolvedValue([
    {
      id: 1,
      email: 'user@example.com',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-02T00:00:00Z'),
    },
  ]);
  prismaMock.kycVerification.findMany.mockResolvedValue([
    {
      address: 'GABC123',
      status: 'Approved',
      reviewResult: 'approved',
      rejectLabels: [],
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T01:00:00Z'),
    },
  ]);
  prismaMock.userProfile.findMany.mockResolvedValue([
    {
      address: 'GABC123',
      displayName: 'User',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T01:00:00Z'),
    },
  ]);
  prismaMock.reputationRecord.findMany.mockResolvedValue([
    {
      address: 'GABC123',
      totalScore: 12n,
      completedEscrows: 2,
      disputedEscrows: 0,
      updatedAt: new Date('2026-03-01T01:00:00Z'),
    },
  ]);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.adminAuditLog.findMany.mockResolvedValue([
    {
      id: 5,
      action: 'SUSPEND_USER',
      targetAddress: 'GABC123',
      reason: 'Review',
      performedBy: 'admin',
      performedAt: new Date('2026-03-01T03:00:00Z'),
    },
  ]);

  // Default count mocks (match findMany lengths above)
  prismaMock.payment.count.mockResolvedValue(1);
  prismaMock.escrow.count.mockResolvedValue(1);
  prismaMock.contractEvent.count.mockResolvedValue(1);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.kycVerification.count.mockResolvedValue(1);
  prismaMock.auditLog.count.mockResolvedValue(0);
  auditServiceMock.search.mockResolvedValue({
    total: 1,
    data: [
      {
        id: 10n,
        category: 'PAYMENT',
        action: 'PAYMENT_COMPLETED',
        actor: 'system',
        resourceId: '42',
        statusCode: 200,
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-03-01T02:00:00Z'),
        metadata: { source: 'test' },
      },
    ],
  });
  auditServiceMock.log.mockResolvedValue(undefined);
});

describe('complianceService', () => {
  it('generates a transaction report with audit trail data', async () => {
    const report = await generateReport('transactions', { from: '2026-03-01T00:00:00Z' }, 'admin');

    expect(report.type).toBe('transactions');
    expect(report.summary.payments).toBe(1);
    expect(report.summary.escrows).toBe(1);
    expect(report.auditTrail.total).toBe(1);
    expect(report.transactions[0].id).toBe('pay_1');
    expect(auditServiceMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPORT_GENERATED', resourceId: 'transactions' }),
    );
  });

  it('exports reports as csv and pdf', async () => {
    const csvExport = await exportReport('transactions', 'csv', {}, 'admin');
    const pdfExport = await exportReport('activity', 'pdf', {}, 'admin');

    expect(csvExport.contentType).toBe('text/csv');
    expect(csvExport.body).toContain('pay_1');
    expect(pdfExport.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(pdfExport.body)).toBe(true);
    expect(pdfExport.body.toString('utf8', 0, 8)).toContain('%PDF');
  });

  it('creates, runs, and disables scheduled reports', async () => {
    const schedule = await createSchedule({
      type: 'transactions',
      format: 'csv',
      frequency: 'daily',
      filters: { address: 'GABC123' },
      createdBy: 'admin',
    });

    expect(listSchedules().schedules).toHaveLength(1);

    schedule.nextRunAt = new Date(Date.now() - 1000).toISOString();
    const runs = await processDueSchedules();
    expect(runs).toHaveLength(1);
    expect(runs[0].scheduleId).toBe(schedule.id);
    expect(listSchedules().history).toHaveLength(1);

    const disabled = await disableSchedule(schedule.id, 'admin');
    expect(disabled.disabled).toBe(true);
  });

  describe('export jobs', () => {
    async function waitForJob(id) {
      for (let i = 0; i < 50; i++) {
        const job = getExportJob(id);
        if (job.status === 'complete' || job.status === 'failed') return job;
        await new Promise((resolve) => setImmediate(resolve));
      }
      throw new Error('export job did not finish');
    }

    it('transitions queued -> running -> complete with queryable progress', async () => {
      let releasePayments;
      const payments = await prismaMock.payment.findMany();
      prismaMock.payment.findMany.mockImplementationOnce(
        () => new Promise((resolve) => (releasePayments = () => resolve(payments))),
      );

      const queued = startExportJob('transactions', 'csv', {}, 'admin');
      expect(queued).toMatchObject({ status: 'queued', progress: 0, ready: false });

      await new Promise((resolve) => setImmediate(resolve));
      expect(getExportJob(queued.id)).toMatchObject({ status: 'running', progress: 10 });

      releasePayments();
      const complete = await waitForJob(queued.id);
      expect(complete).toMatchObject({ status: 'complete', progress: 100, ready: true });
      expect(getExportJobResult(queued.id).body).toContain('pay_1');
    });

    it('transitions to failed when report generation throws', async () => {
      const job = startExportJob('unknown-type', 'json', {}, 'admin');

      const failed = await waitForJob(job.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/Unsupported/);
      expect(getExportJobResult(job.id)).toBeNull();
    });

    it('rejects unsupported formats and unknown job ids', () => {
      expect(() => startExportJob('transactions', 'xml')).toThrow(/Unsupported export format/);
      expect(getExportJob('export_missing')).toBeNull();
    });
  });
});

// ── validateFilters ───────────────────────────────────────────────────────────

describe('validateFilters', () => {
  it('passes for a valid transactions filter set', () => {
    expect(() =>
      validateFilters('transactions', {
        from: '2026-01-01',
        to: '2026-03-31',
        status: 'Completed',
        format: 'csv',
        tenant: 'acme',
      }),
    ).not.toThrow();
  });

  it('passes for a valid users filter with kycStatus', () => {
    expect(() =>
      validateFilters('users', { status: 'Approved', format: 'json' }),
    ).not.toThrow();
  });

  it('passes for activity report with no status constraint', () => {
    expect(() => validateFilters('activity', { from: '2026-01-01' })).not.toThrow();
  });

  it('throws for an unknown report type', () => {
    expect(() => validateFilters('unknown', {})).toThrow(/Unsupported report type/);
  });

  it('throws when "from" is an invalid date string', () => {
    expect(() =>
      validateFilters('transactions', { from: 'not-a-date' }),
    ).toThrow(/Invalid "from" date/);
  });

  it('throws when "to" is an invalid date string', () => {
    expect(() =>
      validateFilters('transactions', { to: 'not-a-date' }),
    ).toThrow(/Invalid "to" date/);
  });

  it('throws when "from" is later than "to"', () => {
    expect(() =>
      validateFilters('transactions', { from: '2026-06-01', to: '2026-01-01' }),
    ).toThrow(/"from" date must not be later than "to" date/);
  });

  it('accepts equal "from" and "to" dates (same-day range)', () => {
    expect(() =>
      validateFilters('transactions', { from: '2026-03-01', to: '2026-03-01' }),
    ).not.toThrow();
  });

  it('throws for an invalid export format', () => {
    expect(() =>
      validateFilters('transactions', { format: 'xlsx' }),
    ).toThrow(/Invalid export format/);
  });

  it('throws for an invalid status on a transactions report', () => {
    expect(() =>
      validateFilters('transactions', { status: 'Unknown' }),
    ).toThrow(/Invalid status/);
  });

  it('throws for an invalid KYC status on a users report', () => {
    expect(() =>
      validateFilters('users', { status: 'Completed' }),
    ).toThrow(/Invalid status/);
  });

  it('ignores empty-string status (treated as "any")', () => {
    expect(() => validateFilters('transactions', { status: '' })).not.toThrow();
    expect(() => validateFilters('users', { status: '' })).not.toThrow();
  });

  it('ignores undefined / null optional fields', () => {
    expect(() =>
      validateFilters('transactions', { from: undefined, to: null, tenant: undefined, status: null }),
    ).not.toThrow();
  });
});

// ── estimateResultSize ────────────────────────────────────────────────────────

describe('estimateResultSize', () => {
  it('returns payment + escrow + event counts for transactions', async () => {
    prismaMock.payment.count.mockResolvedValue(5);
    prismaMock.escrow.count.mockResolvedValue(3);
    prismaMock.contractEvent.count.mockResolvedValue(10);

    const result = await estimateResultSize('transactions', {});

    expect(result.type).toBe('transactions');
    expect(result.counts).toEqual({ payments: 5, escrows: 3, ledgerEvents: 10 });
    expect(result.totalEstimate).toBe(18);
  });

  it('returns user + kyc counts for users', async () => {
    prismaMock.user.count.mockResolvedValue(50);
    prismaMock.kycVerification.count.mockResolvedValue(40);

    const result = await estimateResultSize('users', {});

    expect(result.type).toBe('users');
    expect(result.counts).toEqual({ users: 50, kycRecords: 40 });
    expect(result.totalEstimate).toBe(50); // totalEstimate is user count
  });

  it('returns auditLog + contractEvent counts for activity', async () => {
    prismaMock.auditLog.count.mockResolvedValue(100);
    prismaMock.contractEvent.count.mockResolvedValue(20);

    const result = await estimateResultSize('activity', {});

    expect(result.type).toBe('activity');
    expect(result.counts).toEqual({ auditLogs: 100, contractEvents: 20 });
    expect(result.totalEstimate).toBe(120);
  });

  it('propagates date range filter to count queries', async () => {
    prismaMock.payment.count.mockResolvedValue(2);
    prismaMock.escrow.count.mockResolvedValue(1);
    prismaMock.contractEvent.count.mockResolvedValue(3);

    await estimateResultSize('transactions', {
      from: '2026-01-01',
      to: '2026-03-31',
    });

    expect(prismaMock.payment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        }),
      }),
    );
  });

  it('propagates status filter for transactions', async () => {
    prismaMock.payment.count.mockResolvedValue(1);
    prismaMock.escrow.count.mockResolvedValue(1);
    prismaMock.contractEvent.count.mockResolvedValue(1);

    await estimateResultSize('transactions', { status: 'Completed' });

    expect(prismaMock.payment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'Completed' }),
      }),
    );
  });

  it('propagates kycStatus filter for users', async () => {
    prismaMock.user.count.mockResolvedValue(10);
    prismaMock.kycVerification.count.mockResolvedValue(8);

    await estimateResultSize('users', { status: 'Approved' });

    expect(prismaMock.kycVerification.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'Approved' }),
      }),
    );
  });

  it('throws for an invalid date range (from > to)', async () => {
    await expect(
      estimateResultSize('transactions', { from: '2026-12-01', to: '2026-01-01' }),
    ).rejects.toThrow(/"from" date must not be later than "to" date/);
  });

  it('throws for an unknown report type', async () => {
    await expect(estimateResultSize('unknown', {})).rejects.toThrow(/Unsupported report type/);
  });
});
