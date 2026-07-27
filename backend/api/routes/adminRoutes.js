/**
 * Admin Routes
 *
 * All routes here require the adminAuth middleware (x-admin-api-key header).
 *
 * @module routes/adminRoutes
 */

import express from 'express';
const router = express.Router();
import adminAuth, { issueAdminToken, ADMIN_TOKEN_TTL } from '../middleware/adminAuth.js';
import { requireMfa } from '../middleware/mfaAuth.js';
import adminController from '../controllers/adminController.js';
import tenantController from '../controllers/tenantController.js';
import * as featureFlagController from '../controllers/featureFlagController.js';
import { getAuditLog, rotateSecrets } from '../../lib/secrets.js';
import cache from '../../lib/cache.js';

// Apply admin authentication to all routes in this file
router.use(adminAuth);

// ── Auth ─────────────────────────────────────────────────────────────────────
/**
 * @route  POST /api/admin/auth/login
 * @desc   Exchange a valid admin API key (validated by adminAuth) for a
 *         short-lived HMAC-signed admin session token. Subsequent requests
 *         should send `Authorization: Bearer <token>` instead of the raw key.
 */
router.post('/auth/login', (req, res) => {
  const token = issueAdminToken(req.admin.adminId);
  res.json({
    token,
    tokenType: 'Bearer',
    expiresIn: ADMIN_TOKEN_TTL,
    adminId: req.admin.adminId,
  });
});

// ── Stats ──────────────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/stats
 * @desc   Platform-wide statistics (total escrows, users, disputes)
 */
router.get('/stats', adminController.getStats);

// ── Users ──────────────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/users
 * @desc   List all users with pagination & search
 * @query  page, limit, search
 */
router.get('/users', adminController.listUsers);

/**
 * @route  GET /api/admin/users/:address
 * @desc   Get detailed profile for a single user
 */
router.get('/users/:address', adminController.getUserDetail);

/**
 * @route  POST /api/admin/users/:address/suspend
 * @desc   Suspend a user; logs action to admin audit log
 * @body   { reason: string }
 * @security Requires MFA verification
 */
router.post('/users/:address/suspend', requireMfa, adminController.suspendUser);

/**
 * @route  POST /api/admin/users/:address/ban
 * @desc   Permanently ban a user; logs action to admin audit log
 * @body   { reason: string }
 * @security Requires MFA verification
 */
router.post('/users/:address/ban', requireMfa, adminController.banUser);

// ── Disputes ───────────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/disputes
 * @desc   List all disputes with pagination
 * @query  page, limit, resolved (true|false)
 */
router.get('/disputes', adminController.listDisputes);

/**
 * @route  POST /api/admin/disputes/:id/resolve
 * @desc   Resolve an open dispute
 * @body   { clientAmount: string, freelancerAmount: string, notes: string }
 * @security Requires MFA verification
 */
router.post('/disputes/:id/resolve', requireMfa, adminController.resolveDispute);

// ── Settings & Fees ────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/settings
 * @desc   Read current platform settings
 */
router.get('/settings', adminController.getSettings);

/**
 * @route  PATCH /api/admin/settings
 * @desc   Update platform settings (fee percentage, etc.)
 * @body   { platformFeePercent: number }
 * @security Requires MFA verification
 */
router.patch('/settings', requireMfa, adminController.updateSettings);

// ── Audit Logs ─────────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/audit-logs
 * @desc   Paginated audit log of all admin actions
 * @query  page, limit
 */
router.get('/audit-logs', adminController.getAuditLogs);

// ── Rate Limits ────────────────────────────────────────────────────────────────
/**
 * @route  GET /api/admin/rate-limits
 * @desc   List all tier rate limit configurations
 */
router.get('/rate-limits', adminController.getRateLimits);

/**
 * @route  PATCH /api/admin/rate-limits/:tier
 * @desc   Update rate limit max for a specific tier
 * @body   { max: number }
 * @security Requires MFA verification
 */
router.patch('/rate-limits/:tier', requireMfa, adminController.updateRateLimit);

/**
 * @route  GET /api/admin/rate-limits/usage/:userId
 * @desc   Get current usage analytics for a specific user
 */
router.get('/rate-limits/usage/:userId', adminController.getUserRateLimitUsage);

// ── Tenants ───────────────────────────────────────────────────────────────────
router.get('/tenants', tenantController.listTenants);
router.post('/tenants', tenantController.createTenant);
router.get('/tenants/:tenantId', tenantController.getTenant);
router.patch('/tenants/:tenantId', tenantController.updateTenant);
router.get('/tenants/:tenantId/metrics', tenantController.getTenantMetrics);

// ── Feature Flags ─────────────────────────────────────────────────────────────
router.get('/flags', featureFlagController.index);
router.post('/flags', featureFlagController.create);
router.patch('/flags/:key', featureFlagController.update);
router.delete('/flags/:key', featureFlagController.destroy);

// Tenant-level flag overrides
router.get('/flags/tenants/:tenantId', featureFlagController.listForTenant);
router.put('/flags/:key/tenants/:tenantId', featureFlagController.setTenantOverride);
router.delete('/flags/:key/tenants/:tenantId', featureFlagController.removeTenantOverride);

/**
 * @route  GET /api/admin/secrets/audit
 * @desc   Returns the in-process secrets access audit log.
 *         Wire to a SIEM or persistent store in production.
 */
router.get('/secrets/audit', (_req, res) => {
  res.json({ data: getAuditLog() });
});

/**
 * @route  POST /api/admin/secrets/rotate
 * @desc   Forces an immediate cache invalidation and re-fetch from the
 *         secrets backend. Use after rotating credentials in Vault.
 * @security Requires MFA verification
 */
router.post('/secrets/rotate', requireMfa, async (_req, res) => {
  try {
    await rotateSecrets();
    res.json({ ok: true, message: 'Secrets rotated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @route  GET /api/admin/cache/stats
 * @desc   Returns cache hit/miss analytics.
 */
router.get('/cache/stats', (_req, res) => {
  res.json(cache.analytics());
});

/**
 * @route  DELETE /api/admin/cache
 * @desc   Flush the entire cache (all tags and keys).
 * @body   { tag?: string, prefix?: string } — optional scope
 * @security Requires MFA verification
 */
router.delete('/cache', requireMfa, async (req, res) => {
  try {
    const { tag, prefix } = req.body ?? {};
    if (tag) {
      await cache.invalidateTag(tag);
      return res.json({ ok: true, invalidated: `tag:${tag}` });
    }
    if (prefix) {
      await cache.invalidatePrefix(prefix);
      return res.json({ ok: true, invalidated: `prefix:${prefix}` });
    }
    // Full flush — invalidate all known top-level tags
    await cache.invalidateTags([
      'escrows',
      'disputes',
      'reputation',
      'reputation:leaderboard',
      'events',
      'events:stats',
      'events:types',
      'milestones',
    ]);
    res.json({ ok: true, invalidated: 'all' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Escrow Archival (scheduled job management) ────────────────────────────────

/**
 * @route  GET /api/admin/archival/stats
 * @desc   Return statistics about escrows eligible for archival.
 */
router.get('/archival/stats', async (req, res) => {
  try {
    const { getArchivalStats } = await import('../../services/escrowArchiveService.js');
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const retentionDays = req.query.retentionDays ? parseInt(req.query.retentionDays, 10) : undefined;
    const stats = await getArchivalStats(prisma, retentionDays);
    await prisma.$disconnect();
    res.json({ data: stats });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * @route  POST /api/admin/archival/run
 * @desc   Trigger the archival job manually. Supports dry-run mode.
 *         Body: { dryRun?: boolean, retentionDays?: number, batchSize?: number }
 */
router.post('/archival/run', requireMfa, async (req, res) => {
  try {
    const { archiveCompletedEscrows } = await import('../../services/escrowArchiveService.js');
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const { dryRun = false, retentionDays, batchSize } = req.body ?? {};
    const result = await archiveCompletedEscrows(prisma, undefined, {
      dryRun: Boolean(dryRun),
      ...(retentionDays != null && { retentionDays: parseInt(retentionDays, 10) }),
      ...(batchSize != null && { batchSize: parseInt(batchSize, 10) }),
    });

    await prisma.$disconnect();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// ── 2FA Compliance ────────────────────────────────────────────────────────────

/**
 * @route  GET /api/admin/2fa/compliance
 * @desc   List admin and arbiter accounts that do not yet have MFA enabled.
 *         Useful for auditing 2FA adoption across privileged roles.
 */
router.get('/2fa/compliance', async (_req, res) => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    // Fetch users with Admin or Arbitrator roles who lack active MFA methods
    const nonCompliant = await prisma.user.findMany({
      where: {
        role: { in: ['Admin', 'Arbitrator'] },
        mfaMethods: { none: { isActive: true } },
      },
      select: { id: true, address: true, role: true, createdAt: true },
      orderBy: { role: 'asc' },
    });

    await prisma.$disconnect();

    res.json({
      data: nonCompliant,
      meta: {
        nonCompliantCount: nonCompliant.length,
        checkedRoles: ['Admin', 'Arbitrator'],
        message:
          nonCompliant.length === 0
            ? 'All admin and arbiter accounts have 2FA enrolled.'
            : `${nonCompliant.length} privileged account(s) lack active MFA methods.`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * @route  POST /api/admin/2fa/enforce
 * @desc   Enforce 2FA requirement for a specific privileged user account.
 *         Sets a flag that blocks login until the user completes MFA setup.
 */
router.post('/2fa/enforce', requireMfa, async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId) {
    return res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'userId is required' } });
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await prisma.$disconnect();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    if (!['Admin', 'Arbitrator'].includes(user.role)) {
      await prisma.$disconnect();
      return res.status(422).json({
        error: { code: 'INVALID_ROLE', message: '2FA enforcement only applies to Admin and Arbitrator roles' },
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnforced: true },
    });

    await prisma.$disconnect();

    res.json({ ok: true, userId, message: '2FA enforcement enabled for user' });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
