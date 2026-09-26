/**
 * KYC Service — Sumsub integration
 *
 * Handles applicant creation, SDK token generation, and webhook signature verification.
 * Docs: https://developers.sumsub.com/api-reference/
 */

import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import auditService, { AuditCategory, AuditAction } from './auditService.js';

const {
  SUMSUB_APP_TOKEN,
  SUMSUB_SECRET_KEY,
  SUMSUB_BASE_URL = 'https://api.sumsub.com',
} = process.env;

const LEVEL_NAME = process.env.SUMSUB_LEVEL_NAME || 'basic-kyc-level';

/** Build a signed Sumsub request (HMAC-SHA256). */
function buildHeaders(method, path, body = '') {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = ts + method.toUpperCase() + path + (body ? body : '');
  const signature = crypto.createHmac('sha256', SUMSUB_SECRET_KEY).update(payload).digest('hex');

  return {
    'X-App-Token': SUMSUB_APP_TOKEN,
    'X-App-Access-Sig': signature,
    'X-App-Access-Ts': ts,
    'Content-Type': 'application/json',
  };
}

async function sumsubFetch(method, path, body) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const res = await fetch(`${SUMSUB_BASE_URL}${path}`, {
    method,
    headers: buildHeaders(method, path, bodyStr),
    body: bodyStr || undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sumsub ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Create or retrieve a Sumsub applicant for the given Stellar address. */
async function getOrCreateApplicant(address) {
  let record = await prisma.kycVerification.findUnique({ where: { address } });

  if (record?.applicantId) return record;

  const applicant = await sumsubFetch('POST', '/resources/applicants?levelName=' + LEVEL_NAME, {
    externalUserId: address,
  });

  record = await prisma.kycVerification.upsert({
    where: { address },
    update: { applicantId: applicant.id, status: 'Init' },
    create: { address, applicantId: applicant.id, status: 'Init' },
  });

  return record;
}

/** Generate a short-lived SDK access token for the frontend widget. */
async function generateSdkToken(address) {
  const record = await getOrCreateApplicant(address);
  const data = await sumsubFetch(
    'POST',
    `/resources/accessTokens?userId=${record.applicantId}&levelName=${LEVEL_NAME}`,
  );
  return { token: data.token, applicantId: record.applicantId };
}

/** Get current KYC status for an address (from DB, not Sumsub). */
async function getStatus(address) {
  return prisma.kycVerification.findUnique({ where: { address } });
}

/** Get all KYC records for admin review (paginated). */
async function listAll({ skip = 0, take = 20, status } = {}) {
  const where = status ? { status } : {};
  const [data, total] = await prisma.$transaction([
    prisma.kycVerification.findMany({ where, skip, take, orderBy: { updatedAt: 'desc' } }),
    prisma.kycVerification.count({ where }),
  ]);
  return { data, total };
}

export const KYC_PROVIDER_ACTOR = 'system:sumsub';
const KYC_STATUSES = ['Pending', 'Init', 'Processing', 'Approved', 'Declined'];

/** Append a status transition row. Skips no-op transitions. */
async function recordTransition({
  tenantId,
  address,
  actor,
  source,
  previousStatus,
  newStatus,
  reason,
}) {
  if (previousStatus === newStatus) return null;
  return prisma.kycStatusTransition.create({
    data: {
      tenantId,
      address,
      actor,
      source,
      previousStatus: previousStatus ?? null,
      newStatus,
      reason: reason ?? null,
    },
  });
}

/** Get the status transition history for an address (oldest first). */
async function getHistory(address) {
  return prisma.kycStatusTransition.findMany({
    where: { address },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Manually override the KYC status for an address (admin action).
 * Records the transition with the admin actor and reason.
 */
async function overrideStatus({ address, status, actor, reason }) {
  if (!KYC_STATUSES.includes(status)) throw new Error(`Invalid KYC status: ${status}`);
  if (!actor) throw new Error('actor is required');
  if (!reason) throw new Error('reason is required');

  const existing = await prisma.kycVerification.findUnique({ where: { address } });
  if (!existing) return null;

  const record = await prisma.kycVerification.update({ where: { address }, data: { status } });

  await recordTransition({
    tenantId: record.tenantId,
    address,
    actor,
    source: 'manual',
    previousStatus: existing.status,
    newStatus: status,
    reason,
  });

  await auditService.log({
    category: AuditCategory.KYC,
    action:
      status === 'Approved'
        ? AuditAction.KYC_APPROVED
        : status === 'Declined'
          ? AuditAction.KYC_DECLINED
          : AuditAction.KYC_SUBMITTED,
    actor,
    resourceId: address,
    metadata: { override: true, previousStatus: existing.status, newStatus: status, reason },
  });

  return record;
}

/**
 * Process a Sumsub webhook event and update DB status.
 * Returns the updated record.
 */
async function handleWebhook(payload) {
  const { externalUserId, applicantId, type, reviewResult } = payload;

  const statusMap = {
    applicantCreated: 'Init',
    applicantPending: 'Processing',
    applicantReviewed: reviewResult?.reviewAnswer === 'GREEN' ? 'Approved' : 'Declined',
  };

  const newStatus = statusMap[type];
  if (!newStatus) return null; // unhandled event type

  const existing = await prisma.kycVerification.findUnique({ where: { address: externalUserId } });

  const record = await prisma.kycVerification.upsert({
    where: { address: externalUserId },
    update: {
      applicantId,
      status: newStatus,
      reviewResult: reviewResult?.reviewAnswer ?? null,
      rejectLabels: reviewResult?.rejectLabels ?? [],
    },
    create: {
      address: externalUserId,
      applicantId,
      status: newStatus,
      reviewResult: reviewResult?.reviewAnswer ?? null,
      rejectLabels: reviewResult?.rejectLabels ?? [],
    },
  });

  await recordTransition({
    tenantId: record.tenantId,
    address: externalUserId,
    actor: KYC_PROVIDER_ACTOR,
    source: 'provider',
    previousStatus: existing?.status ?? null,
    newStatus,
    reason: reviewResult?.rejectLabels?.length ? reviewResult.rejectLabels.join(', ') : type,
  });

  const actionMap = {
    applicantReviewed:
      reviewResult?.reviewAnswer === 'GREEN' ? AuditAction.KYC_APPROVED : AuditAction.KYC_DECLINED,
  };
  const auditAction = actionMap[type] ?? AuditAction.KYC_SUBMITTED;

  await auditService.log({
    category: AuditCategory.KYC,
    action: auditAction,
    actor: externalUserId,
    resourceId: applicantId,
    metadata: { type, reviewResult },
  });

  return record;
}

/**
 * Verify Sumsub webhook HMAC signature.
 * Returns true if valid.
 */
function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto.createHmac('sha256', SUMSUB_SECRET_KEY).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export default {
  generateSdkToken,
  getStatus,
  listAll,
  getHistory,
  overrideStatus,
  handleWebhook,
  verifyWebhookSignature,
};
