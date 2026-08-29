/**
 * Audit Service
 *
 * Central service for writing and querying the immutable AuditLog table.
 * Records are append-only — no update or delete operations are exposed.
 *
 * @module services/auditService
 */

import { stringify } from 'csv-stringify/sync';
import { createModuleLogger } from '../config/logger.js';
import prisma from '../lib/prisma.js';
import { withSpan } from '../lib/tracing.js';

const auditLogger = createModuleLogger('auditService');

// ── Categories & Actions ──────────────────────────────────────────────────────

/**
 * @typedef {object} AuditLogEntry
 * @property {string} id
 * @property {string} category - one of {@link AuditCategory}
 * @property {string} action - one of {@link AuditAction}
 * @property {string} actor - Stellar address, "admin", or "system"
 * @property {string|null} resourceId
 * @property {object|null} metadata
 * @property {number|null} statusCode
 * @property {string|null} ipAddress
 * @property {Date} createdAt
 */

/**
 * Enumeration of top-level audit log categories used to group related actions.
 * @type {Record<string, string>}
 */
export const AuditCategory = {
  AUTH: 'AUTH',
  ESCROW: 'ESCROW',
  MILESTONE: 'MILESTONE',
  DISPUTE: 'DISPUTE',
  ADMIN: 'ADMIN',
  PAYMENT: 'PAYMENT',
  KYC: 'KYC',
  REPORTING: 'REPORTING',
};

/**
 * Enumeration of specific audit actions recorded across all categories.
 * @type {Record<string, string>}
 */
export const AuditAction = {
  // Auth
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  AUTH_FAILED: 'AUTH_FAILED',
  // Escrow
  CREATE_ESCROW: 'CREATE_ESCROW',
  CANCEL_ESCROW: 'CANCEL_ESCROW',
  COMPLETE_ESCROW: 'COMPLETE_ESCROW',
  // Milestone
  ADD_MILESTONE: 'ADD_MILESTONE',
  SUBMIT_MILESTONE: 'SUBMIT_MILESTONE',
  APPROVE_MILESTONE: 'APPROVE_MILESTONE',
  REJECT_MILESTONE: 'REJECT_MILESTONE',
  // Dispute
  RAISE_DISPUTE: 'RAISE_DISPUTE',
  RESOLVE_DISPUTE: 'RESOLVE_DISPUTE',
  SUBMIT_EVIDENCE: 'SUBMIT_EVIDENCE',
  ESCALATE_DISPUTE: 'ESCALATE_DISPUTE',
  SUBMIT_APPEAL: 'SUBMIT_APPEAL',
  REVIEW_APPEAL: 'REVIEW_APPEAL',
  // Admin
  SUSPEND_USER: 'SUSPEND_USER',
  BAN_USER: 'BAN_USER',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  // Payment
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  // KYC
  KYC_SUBMITTED: 'KYC_SUBMITTED',
  KYC_APPROVED: 'KYC_APPROVED',
  KYC_DECLINED: 'KYC_DECLINED',
  // Reporting
  REPORT_GENERATED: 'REPORT_GENERATED',
  REPORT_EXPORTED: 'REPORT_EXPORTED',
  REPORT_SCHEDULED: 'REPORT_SCHEDULED',
  REPORT_SCHEDULED_RUN: 'REPORT_SCHEDULED_RUN',
  REPORT_SCHEDULE_DISABLED: 'REPORT_SCHEDULE_DISABLED',
};

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Append a new audit record. Never throws — failures are logged to stderr
 * so that a logging error never breaks the main request flow.
 *
 * @param {object} entry
 * @param {string} entry.category  - AuditCategory value
 * @param {string} entry.action    - AuditAction value
 * @param {string} entry.actor     - Stellar address, "admin", or "system"
 * @param {string} [entry.resourceId]
 * @param {object} [entry.metadata]
 * @param {number} [entry.statusCode]
 * @param {string} [entry.ipAddress]
 * @returns {Promise<void>} resolves once the write attempt completes (success or logged failure)
 */
export async function log(entry) {
  try {
    await withSpan(
      'auditService.log',
      {
        'audit.category': entry.category,
        'audit.action': entry.action,
      },
      async () => {
        await prisma.auditLog.create({
          data: {
            category: entry.category,
            action: entry.action,
            actor: entry.actor,
            resourceId: entry.resourceId ?? null,
            metadata: entry.metadata ?? undefined,
            statusCode: entry.statusCode ?? null,
            ipAddress: entry.ipAddress ?? null,
          },
        });
      },
    );
  } catch (err) {
    auditLogger.error({
      message: 'audit_write_failed',
      error: err.message,
      stack: err.stack,
    });
  }
}

// ── Shared filter builder ─────────────────────────────────────────────────────

/**
 * Builds a Prisma `where` clause from the standard audit log filter shape.
 * Reused by search() and exportCsv() to avoid logic drift.
 *
 * @param {object} [filters]
 * @param {string} [filters.category]
 * @param {string} [filters.action]
 * @param {string} [filters.actor]
 * @param {string} [filters.resourceId]
 * @param {string} [filters.from] - ISO date string
 * @param {string} [filters.to] - ISO date string
 * @returns {object} Prisma-compatible where clause
 */
function buildWhereClause({ category, action, actor, resourceId, from, to } = {}) {
  const where = {};
  if (category) where.category = category;
  if (action) where.action = action;
  if (actor) where.actor = { contains: actor, mode: 'insensitive' };
  if (resourceId) where.resourceId = { contains: resourceId, mode: 'insensitive' };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  return where;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search audit logs with optional filters and pagination.
 *
 * @param {object} filters
 * @param {string}  [filters.category]
 * @param {string}  [filters.action]
 * @param {string}  [filters.actor]
 * @param {string}  [filters.resourceId]
 * @param {string}  [filters.from]   - ISO date string
 * @param {string}  [filters.to]     - ISO date string
 * @param {number}  [filters.page=1]
 * @param {number}  [filters.limit=50]
 * @returns {Promise<{ data: AuditLogEntry[], total: number, page: number, limit: number, pages: number }>}
 */
export async function search(filters = {}) {
  const page = Math.max(1, parseInt(filters.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit) || 50));
  const skip = (page - 1) * limit;

  const where = buildWhereClause(filters);

  const [data, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page, limit, pages: Math.ceil(total / limit) };
}

// ── Export ────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'id',
  'category',
  'action',
  'actor',
  'resourceId',
  'statusCode',
  'ipAddress',
  'createdAt',
];

/**
 * Export audit logs matching the given filters as a CSV string.
 * Capped at 10 000 rows to prevent memory exhaustion.
 *
 * @param {object} filters - same shape as search() filters (page/limit ignored)
 * @returns {Promise<string>} CSV content
 */
export async function exportCsv(filters = {}) {
  const where = buildWhereClause(filters);

  const rows = await prisma.auditLog.findMany({
    where,
    take: 10_000,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      category: true,
      action: true,
      actor: true,
      resourceId: true,
      statusCode: true,
      ipAddress: true,
      createdAt: true,
    },
  });

  return stringify(rows, { header: true, columns: CSV_COLUMNS });
}

// ── Retention ─────────────────────────────────────────────────────────────────

/**
 * Delete audit records older than `retentionDays` days.
 * Intended to be called by a scheduled job (e.g. cron).
 *
 * @param {number} retentionDays
 * @returns {Promise<number>} count of deleted records
 */
export async function purgeOldRecords(retentionDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return count;
}

/**
 * Default export bundling all audit service functions and enums for
 * consumers that prefer a single namespaced import.
 * @type {{ log: log, search: search, exportCsv: exportCsv, purgeOldRecords: purgeOldRecords, AuditCategory: object, AuditAction: object }}
 */
export default { log, search, exportCsv, purgeOldRecords, AuditCategory, AuditAction };
