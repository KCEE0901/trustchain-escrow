/**
 * Metrics Routes — Issue #191: Tenant-Level Access Control
 *
 * Access tiers:
 *
 *  1. GET /metrics        — Prometheus scrape endpoint
 *     Requires METRICS_TOKEN bearer auth (no user session involved).
 *     Intended for the Prometheus server, not end users.
 *
 *  2. GET /metrics/tenant — Tenant-scoped metrics
 *     Requires a valid JWT (authMiddleware) AND the caller must be
 *     a tenant admin (req.user.role === 'tenant_admin' or 'Admin').
 *     Returns metrics filtered to the caller's own tenantId only.
 *
 *  3. GET /metrics/global — Platform-wide aggregated metrics
 *     Requires a valid JWT AND system admin role (req.user.role === 'Admin'
 *     or req.user.isSystemAdmin === true).
 *     Returns the full Prometheus registry (same as /metrics but auth'd).
 *
 * This design ensures:
 *  - Tenant admins can only observe their own tenant's data.
 *  - System admins can observe global data.
 *  - Regular authenticated users are denied both endpoints (403).
 *  - Unauthenticated requests are denied (401).
 */

import express from 'express';
import { register, cacheSize } from '../../lib/metrics.js';
import cache from '../../lib/cache.js';
import authMiddleware from '../middleware/auth.js';
import prisma from '../../lib/prisma.js';
import { logControllerError } from '../../config/logger.js';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when the request carries a bearer token that matches
 * the configured METRICS_TOKEN environment variable.
 * When no token is configured the scrape endpoint is open (internal networks).
 */
function hasMetricsToken(req) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${token}`;
}

/**
 * Derives the caller's role from req.user, tolerating both array and string
 * role representations produced by different auth flows.
 */
function getUserRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles)) return user.roles;
  if (user.role) return [user.role];
  return [];
}

const SYSTEM_ADMIN_ROLES = new Set(['Admin', 'system_admin']);
const TENANT_ADMIN_ROLES = new Set(['Admin', 'system_admin', 'tenant_admin']);

function isSystemAdmin(user) {
  if (user?.isSystemAdmin) return true;
  return getUserRoles(user).some((r) => SYSTEM_ADMIN_ROLES.has(r));
}

function isTenantAdmin(user) {
  return getUserRoles(user).some((r) => TENANT_ADMIN_ROLES.has(r));
}

// ── Middleware ────────────────────────────────────────────────────────────────

/** Guard: only system admins may proceed. */
function requireSystemAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!isSystemAdmin(req.user)) {
    return res.status(403).json({ error: 'Forbidden: system admin access required' });
  }
  return next();
}

/** Guard: tenant admins and system admins may proceed. */
function requireTenantAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!isTenantAdmin(req.user)) {
    return res.status(403).json({ error: 'Forbidden: tenant admin access required' });
  }
  return next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /metrics
 * Prometheus scrape endpoint — token-protected, no user session.
 */
router.get('/', (req, res) => {
  if (!hasMetricsToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Keep cache size gauge in sync before scraping
  try { cacheSize.set(cache.size()); } catch { /* non-fatal */ }

  register
    .metrics()
    .then((output) => {
      res.set('Content-Type', register.contentType);
      res.end(output);
    })
    .catch((err) => res.status(500).end(err.message));
});

/**
 * GET /metrics/tenant
 * Tenant-scoped metrics: escrow counts, dispute counts, and volume for the
 * caller's own tenant. Tenant admins see only their own data.
 * System admins may pass ?tenantId=<id> to query any tenant.
 */
router.get('/tenant', authMiddleware, requireTenantAdmin, async (req, res) => {
  try {
    // System admins can query any tenantId via query param; others are locked
    // to their own tenantId from the JWT / tenant middleware.
    const tenantId =
      isSystemAdmin(req.user) && req.query.tenantId
        ? req.query.tenantId
        : (req.tenant?.id ?? req.user?.tenantId);

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId could not be resolved for this request' });
    }

    const [escrowCounts, disputeCount] = await Promise.all([
      prisma.escrow.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { id: true },
      }),
      prisma.dispute.count({
        where: { tenantId, resolvedAt: null },
      }),
    ]);

    const byStatus = Object.fromEntries(
      escrowCounts.map((r) => [r.status, r._count.id]),
    );
    const totalEscrows = escrowCounts.reduce((s, r) => s + r._count.id, 0);

    return res.json({
      tenantId,
      escrows: {
        total: totalEscrows,
        active: byStatus.Active ?? 0,
        completed: byStatus.Completed ?? 0,
        disputed: byStatus.Disputed ?? 0,
        cancelled: byStatus.Cancelled ?? 0,
      },
      disputes: { open: disputeCount },
    });
  } catch (err) {
    logControllerError('metrics.tenant', err, req);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /metrics/global
 * Platform-wide Prometheus metrics — system admin only.
 * Returns the full registry text (same payload as GET /metrics but authenticated).
 */
router.get('/global', authMiddleware, requireSystemAdmin, async (_req, res) => {
  try {
    cacheSize.set(cache.size());
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

export default router;
