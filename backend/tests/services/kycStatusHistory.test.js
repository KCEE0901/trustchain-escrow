import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prismaMock = {
  kycVerification: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  kycStatusTransition: { create: jest.fn(), findMany: jest.fn() },
};
const auditServiceMock = { log: jest.fn() };

jest.unstable_mockModule('../../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../../services/auditService.js', () => ({
  AuditAction: {
    KYC_SUBMITTED: 'KYC_SUBMITTED',
    KYC_APPROVED: 'KYC_APPROVED',
    KYC_DECLINED: 'KYC_DECLINED',
  },
  AuditCategory: { KYC: 'KYC' },
  default: auditServiceMock,
}));

const { default: kycService, KYC_PROVIDER_ACTOR } = await import('../../services/kycService.js');

const ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

describe('KYC status transition history', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records an automatic transition from a provider webhook', async () => {
    prismaMock.kycVerification.findUnique.mockResolvedValue({
      address: ADDRESS,
      status: 'Processing',
    });
    prismaMock.kycVerification.upsert.mockResolvedValue({
      address: ADDRESS,
      tenantId: 't1',
      status: 'Declined',
    });

    await kycService.handleWebhook({
      externalUserId: ADDRESS,
      applicantId: 'app-1',
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'RED', rejectLabels: ['FORGERY'] },
    });

    expect(prismaMock.kycStatusTransition.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        address: ADDRESS,
        actor: KYC_PROVIDER_ACTOR,
        source: 'provider',
        previousStatus: 'Processing',
        newStatus: 'Declined',
        reason: 'FORGERY',
      },
    });
  });

  it('skips no-op provider transitions', async () => {
    prismaMock.kycVerification.findUnique.mockResolvedValue({
      address: ADDRESS,
      status: 'Processing',
    });
    prismaMock.kycVerification.upsert.mockResolvedValue({
      address: ADDRESS,
      tenantId: 't1',
      status: 'Processing',
    });

    await kycService.handleWebhook({
      externalUserId: ADDRESS,
      applicantId: 'app-1',
      type: 'applicantPending',
    });

    expect(prismaMock.kycStatusTransition.create).not.toHaveBeenCalled();
  });

  it('records a manual override with actor, reason and tenant', async () => {
    prismaMock.kycVerification.findUnique.mockResolvedValue({
      address: ADDRESS,
      tenantId: 't1',
      status: 'Declined',
    });
    prismaMock.kycVerification.update.mockResolvedValue({
      address: ADDRESS,
      tenantId: 't1',
      status: 'Approved',
    });

    const record = await kycService.overrideStatus({
      address: ADDRESS,
      status: 'Approved',
      actor: 'admin-7',
      reason: 'Documents re-verified manually',
    });

    expect(record.status).toBe('Approved');
    expect(prismaMock.kycStatusTransition.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        address: ADDRESS,
        actor: 'admin-7',
        source: 'manual',
        previousStatus: 'Declined',
        newStatus: 'Approved',
        reason: 'Documents re-verified manually',
      },
    });
    expect(auditServiceMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin-7',
        metadata: expect.objectContaining({ override: true }),
      }),
    );
  });

  it('rejects overrides without a reason or with an invalid status', async () => {
    await expect(
      kycService.overrideStatus({ address: ADDRESS, status: 'Approved', actor: 'a' }),
    ).rejects.toThrow('reason is required');
    await expect(
      kycService.overrideStatus({ address: ADDRESS, status: 'Bogus', actor: 'a', reason: 'x' }),
    ).rejects.toThrow('Invalid KYC status');
  });

  it('returns null when overriding a missing record', async () => {
    prismaMock.kycVerification.findUnique.mockResolvedValue(null);
    const result = await kycService.overrideStatus({
      address: ADDRESS,
      status: 'Approved',
      actor: 'a',
      reason: 'x',
    });
    expect(result).toBeNull();
    expect(prismaMock.kycStatusTransition.create).not.toHaveBeenCalled();
  });

  it('returns history ordered oldest first', async () => {
    prismaMock.kycStatusTransition.findMany.mockResolvedValue([]);
    await kycService.getHistory(ADDRESS);
    expect(prismaMock.kycStatusTransition.findMany).toHaveBeenCalledWith({
      where: { address: ADDRESS },
      orderBy: { createdAt: 'asc' },
    });
  });
});
