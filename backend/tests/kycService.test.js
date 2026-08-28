/**
 * Integration tests for kycService.js — issue #225
 *
 * Exercises the full happy-path flow:
 *   1. getOrCreateApplicant  — creates a new applicant via Sumsub API
 *   2. generateSdkToken      — obtains a short-lived SDK access token
 *   3. getStatus             — retrieves the KYC record from DB
 *   4. listAll               — paginates all KYC records
 *   5. handleWebhook         — processes applicantReviewed (Approved / Declined)
 *   6. verifyWebhookSignature — validates HMAC-SHA256 signature
 */

import crypto from 'crypto';
import { jest } from '@jest/globals';

// ── Prisma mock ────────────────────────────────────────────────────────────────
const prismaMock = {
  kycVerification: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(async (ops) =>
    Array.isArray(ops) ? Promise.all(ops) : ops(prismaMock),
  ),
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));

// ── auditService mock ──────────────────────────────────────────────────────────
const auditMock = { log: jest.fn().mockResolvedValue(undefined) };
jest.unstable_mockModule('../services/auditService.js', () => ({
  default: auditMock,
  AuditCategory: { KYC: 'KYC' },
  AuditAction: {
    KYC_SUBMITTED: 'KYC_SUBMITTED',
    KYC_APPROVED: 'KYC_APPROVED',
    KYC_DECLINED: 'KYC_DECLINED',
  },
}));

// ── fetch mock ─────────────────────────────────────────────────────────────────
const fetchMock = jest.fn();
global.fetch = fetchMock;

// ── env ───────────────────────────────────────────────────────────────────────
process.env.SUMSUB_APP_TOKEN = 'test-app-token';
process.env.SUMSUB_SECRET_KEY = 'test-secret-key';
process.env.SUMSUB_BASE_URL = 'https://api.sumsub.com';
process.env.SUMSUB_LEVEL_NAME = 'basic-kyc-level';

const kycService = (await import('../services/kycService.js')).default;

const STELLAR_ADDRESS = 'GABC1234567890EXAMPLEADDRESS';
const APPLICANT_ID = 'applicant_abc123';
const SDK_TOKEN = 'sdk_token_xyz789';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFetchResponse(data) {
  return {
    ok: true,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function mockNewApplicant() {
  // First findUnique — no record yet
  prismaMock.kycVerification.findUnique.mockResolvedValueOnce(null);
  // POST /resources/applicants → Sumsub applicant
  fetchMock.mockResolvedValueOnce(
    makeFetchResponse({ id: APPLICANT_ID, externalUserId: STELLAR_ADDRESS }),
  );
  // upsert → stored record
  prismaMock.kycVerification.upsert.mockResolvedValueOnce({
    address: STELLAR_ADDRESS,
    applicantId: APPLICANT_ID,
    status: 'Init',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('kycService — happy-path flow', () => {
  it('generates an SDK token for a new address (creates applicant first)', async () => {
    mockNewApplicant();
    // POST /resources/accessTokens → token
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ token: SDK_TOKEN }),
    );

    const result = await kycService.generateSdkToken(STELLAR_ADDRESS);

    expect(result.token).toBe(SDK_TOKEN);
    expect(result.applicantId).toBe(APPLICANT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call must be applicant creation
    expect(fetchMock.mock.calls[0][0]).toContain('/resources/applicants');
    // Second call must be token generation
    expect(fetchMock.mock.calls[1][0]).toContain('/resources/accessTokens');
  });

  it('reuses an existing applicant when already in DB', async () => {
    // findUnique returns existing record — no Sumsub API call for applicant
    prismaMock.kycVerification.findUnique.mockResolvedValueOnce({
      address: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      status: 'Processing',
    });
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({ token: SDK_TOKEN }),
    );

    const result = await kycService.generateSdkToken(STELLAR_ADDRESS);

    expect(result.token).toBe(SDK_TOKEN);
    // Only one fetch — for the token, not applicant creation
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getStatus returns the KYC record for a given address', async () => {
    const record = {
      address: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      status: 'Approved',
    };
    prismaMock.kycVerification.findUnique.mockResolvedValueOnce(record);

    const result = await kycService.getStatus(STELLAR_ADDRESS);

    expect(result).toEqual(record);
    expect(prismaMock.kycVerification.findUnique).toHaveBeenCalledWith({
      where: { address: STELLAR_ADDRESS },
    });
  });

  it('getStatus returns null when address has no KYC record', async () => {
    prismaMock.kycVerification.findUnique.mockResolvedValueOnce(null);
    const result = await kycService.getStatus('GUNKNOWN');
    expect(result).toBeNull();
  });

  it('listAll returns paginated records and total count', async () => {
    const records = [
      { address: 'GA1', applicantId: 'a1', status: 'Approved' },
      { address: 'GA2', applicantId: 'a2', status: 'Processing' },
    ];
    prismaMock.$transaction.mockResolvedValueOnce([records, 2]);

    const result = await kycService.listAll({ skip: 0, take: 20 });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('listAll filters by status when provided', async () => {
    const approved = [{ address: 'GA1', applicantId: 'a1', status: 'Approved' }];
    prismaMock.$transaction.mockResolvedValueOnce([approved, 1]);

    const result = await kycService.listAll({ status: 'Approved' });

    expect(result.total).toBe(1);
    expect(result.data[0].status).toBe('Approved');
  });

  it('handleWebhook — applicantReviewed GREEN → Approved status and audit log', async () => {
    const updatedRecord = {
      address: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      status: 'Approved',
      reviewResult: 'GREEN',
      rejectLabels: [],
    };
    prismaMock.kycVerification.upsert.mockResolvedValueOnce(updatedRecord);

    const payload = {
      externalUserId: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'GREEN', rejectLabels: [] },
    };

    const result = await kycService.handleWebhook(payload);

    expect(result.status).toBe('Approved');
    expect(prismaMock.kycVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { address: STELLAR_ADDRESS },
        update: expect.objectContaining({ status: 'Approved' }),
      }),
    );
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'KYC',
        action: 'KYC_APPROVED',
        actor: STELLAR_ADDRESS,
      }),
    );
  });

  it('handleWebhook — applicantReviewed RED → Declined status and audit log', async () => {
    const updatedRecord = {
      address: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      status: 'Declined',
      reviewResult: 'RED',
      rejectLabels: ['FORGERY'],
    };
    prismaMock.kycVerification.upsert.mockResolvedValueOnce(updatedRecord);

    const payload = {
      externalUserId: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      type: 'applicantReviewed',
      reviewResult: { reviewAnswer: 'RED', rejectLabels: ['FORGERY'] },
    };

    const result = await kycService.handleWebhook(payload);

    expect(result.status).toBe('Declined');
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KYC_DECLINED' }),
    );
  });

  it('handleWebhook — applicantCreated → Init status', async () => {
    prismaMock.kycVerification.upsert.mockResolvedValueOnce({
      address: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      status: 'Init',
    });

    const result = await kycService.handleWebhook({
      externalUserId: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      type: 'applicantCreated',
    });

    expect(result.status).toBe('Init');
  });

  it('handleWebhook — unknown event type returns null', async () => {
    const result = await kycService.handleWebhook({
      externalUserId: STELLAR_ADDRESS,
      applicantId: APPLICANT_ID,
      type: 'unknownEventType',
    });
    expect(result).toBeNull();
    expect(prismaMock.kycVerification.upsert).not.toHaveBeenCalled();
  });

  it('verifyWebhookSignature — returns true for valid signature', () => {
    const rawBody = JSON.stringify({ type: 'applicantCreated', externalUserId: STELLAR_ADDRESS });
    const signature = crypto
      .createHmac('sha256', process.env.SUMSUB_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    expect(kycService.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it('verifyWebhookSignature — returns false for invalid signature', () => {
    const rawBody = JSON.stringify({ type: 'applicantCreated' });
    const badSig = 'deadbeef'.repeat(8);
    expect(kycService.verifyWebhookSignature(rawBody, badSig)).toBe(false);
  });
});
