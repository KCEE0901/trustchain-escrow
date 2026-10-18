/**
 * Admin Controller
 *
 * Handles all admin-only operations: user management, dispute resolution,
 * platform statistics, fee management, and audit logs.
 *
 * @module controllers/adminController
 */

import prisma from '../../lib/prisma.js';
import { TIER_LIMITS } from '../../config/rateLimits.js';
import { logControllerError, getLogger } from '../../config/logger.js';
import { getUserUsage } from '../middleware/rateLimiter.js';

const adminLog = getLogger();

// Mutable runtime overrides (resets on server restart)
const runtimeTierLimits = { ...TIER_LIMITS };

// ── Dynamic admin settings persistence ────────────────────────────────────────
// In-memory store for dynamic admin settings. Values are persisted as-is but
// telemetry never records the raw value — only bounded metadata.
const dynamicSettings = new Map();

const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_SETTING_VALUE_BYTES = 4096;

/**
 * Emit a bounded, deterministic telemetry event for a settings operation.
 * Never includes the setting value or any secret material.
 */
function emitSettingsTelemetry({ outcome, key, reason, requestId, performedBy, durationMs }) {
  const event = {
    type: 'admin_settings_telemetry',
    action: 'PERSIST_DYNAMIC_SETTING',
    outcome,
    key: typeof key === 'string' && SETTING_KEY_PATTERN.test(key) ? key : 'invalid',
    reason: reason ?? null,
    requestId: requestId ?? null,
    performedBy: performedBy ?? 'unknown',
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
  };
  if (outcome === 'success') {
    adminLog.info(event);
  } else {
    adminLog.warn(event);
  }
}

/**
 * PUT /api/admin/settings/:key
 * Persists a dynamic admin setting. Emits structured telemetry for the success
 * path and for validation / persistence failure paths.
 */
const updateDynamicSetting = async (req, res) => {
  const startedAt = Date.now();
  const { key } = req.params;
  const { value } = req.body ?? {};
  const performedBy = req.user?.address ?? 'unknown';
  const requestId = req.id;

  if (typeof key !== 'string' || !SETTING_KEY_PATTERN.test(key)) {
    emitSettingsTelemetry({
      outcome: 'rejected',
      key,
      reason: 'invalid_key',
      requestId,
      performedBy,
      durationMs: Date.now() - startedAt,
    });
    return res.status(400).json({ error: 'Invalid setting key.' });
  }

  if (value === undefined) {
    emitSettingsTelemetry({
      outcome: 'rejected',
      key,
      reason: 'missing_value',
      requestId,
      performedBy,
      durationMs: Date.now() - startedAt,
    });
    return res.status(400).json({ error: 'value is required.' });
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    emitSettingsTelemetry({
      outcome: 'rejected',
      key,
      reason: 'unserializable_value',
      requestId,
      performedBy,
      durationMs: Date.now() - startedAt,
    });
    return res.status(400).json({ error: 'value must be JSON-serializable.' });
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_SETTING_VALUE_BYTES) {
    emitSettingsTelemetry({
      outcome: 'rejected',
      key,
      reason: 'value_too_large',
      requestId,
      performedBy,
      durationMs: Date.now() - startedAt,
    });
    return res.status(413).json({ error: 'value exceeds maximum size.' });
  }

  try {
    dynamicSettings.set(key, value);
  } catch (err) {
    emitSettingsTelemetry({
      outcome: 'error',
      key,
      reason: 'persistence_error',
      requestId,
      performedBy,
      durationMs: Date.now() - startedAt,
    });
    logControllerError('admin.updateDynamicSetting', err, req);
    return res.status(500).json({ error: 'Failed to persist setting.' });
  }

  emitSettingsTelemetry({
    outcome: 'success',
    key,
    requestId,
    performedBy,
    durationMs: Date.now() - startedAt,
  });

  res.json({ key, updated: true });
};

const getRateLimits = (_req, res) => {
  res.json({ tiers: runtimeTierLimits });
};

const updateRateLimit = (req, res) => {
  const { tier } = req.params;
  const { max } = req.body;
  if (!(tier in runtimeTierLimits)) {
    return res.status(404).json({ error: `Unknown tier: ${tier}` });
  }
  const parsed = parseInt(max, 10);
  if (isNaN(parsed) || parsed < 1) {
    return res.status(400).json({ error: 'max must be a positive integer' });
  }
  const previous = runtimeTierLimits[tier];
  runtimeTierLimits[tier] = parsed;

  adminLog.warn({
    type: 'admin_action',
    action: 'UPDATE_RATE_LIMIT',
    tier,
    previous,
    updated: parsed,
    performedBy: req.user?.address ?? 'unknown',
    requestId: req.id,
  });

  res.json({ tier, max: parsed });
};

const getUserRateLimitUsage = (req, res) => {
  const { userId } = req.params;
  const usage = getUserUsage(userId);
  res.json({ userId, ...usage });
};

import cache from '../../lib/cache.js';
import { buildPaginatedResponse, parsePagination } from '../../lib/pagination.js';

/** Deterministic JSON serialiser — sorts object keys recursively. */
function stableStringify(val) {
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`;
  if (val !== null && typeof val === 'object') {
    const pairs = Object.keys(val)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(val[k])}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(val);
}

// ── Users ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Returns a paginated list of all users (reputation records).
 */
const listUsers = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { search = '' } = req.query;

    const where = search ? { address: { contains: search, mode: 'insensitive' } } : {};

    const cacheKey = `admin:users:${stableStringify({ limit, page, where })}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [users, total] = await prisma.$transaction([
      prisma.reputationRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { totalScore: 'desc' },
        select: {
          address: true,
          totalScore: true,
          completedEscrows: true,
          disputedEscrows: true,
          disputesWon: true,
          totalVolume: true,
          lastUpdated: true,
        },
      }),
      prisma.reputationRecord.count({ where }),
    ]);

    const result = buildPaginatedResponse(users, { total, page, limit });
    await cache.set(cacheKey, result, 30);
    res.json(result);
  } catch (err) {
    logControllerError('admin.listUsers', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/admin/users/:address
 * Returns a detailed profile for a specific user.
 */
const getUserDetail = async (req, res) => {
  try {
    const { address } = req.params;

    const cacheKey = `admin:user:${address}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Use two targeted queries instead of OR — leverages composite indexes
    const [reputation, escrowsAsClient, escrowsAsFreelancer] = await Promise.all([
      prisma.reputationRecord.findUnique({ where: { address } }),
      prisma.escrow.count({ where: { clientAddress: address } }),
      prisma.escrow.count({ where: { freelancerAddress: address } }),
    ]);

    if (!reputation) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const result = {
      address,
      reputation,
      stats: { escrowsAsClient, escrowsAsFreelancer },
    };

    await cache.set(cacheKey, result, 60);
    res.json(result);
  } catch (err) {
    logControllerError('admin.getUserDetail', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/users/:address/suspend
 * Suspends a user (sets a suspension flag in the audit log — placeholder).
 */
const suspendUser = async (req, res) => {
  try {
    const { address } = req.params;
    const { reason = 'No reason provided' } = req.body;

    // Use a transaction to atomically verify user existence and log the action
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.reputationRecord.findUnique({
        where: { address },
        select: { address: true },
      });
      if (!user) return null;

      const auditEntry = await tx.adminAuditLog.create({
        data: {
          action: 'SUSPEND_USER',
          targetAddress: address,
          reason,
          performedBy: 'admin',
          performedAt: new Date(),
        },
      });

      return auditEntry;
    });

    if (!result) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await cache.invalidatePrefix(`admin:user:${address}`);
    res.json({ message: `User ${address} suspended.`, auditEntry: result });
  } catch (err) {
    logControllerError('admin.suspendUser', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/users/:address/ban
 * Permanently bans a user.
 */
const banUser = async (req, res) => {
  try {
    const { address } = req.params;
    const { reason = 'No reason provided' } = req.body;

    // Use a transaction to atomically verify user existence and log the action
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.reputationRecord.findUnique({
        where: { address },
        select: { address: true },
      });
      if (!user) return null;

      const auditEntry = await tx.adminAuditLog.create({
        data: {
          action: 'BAN_USER',
          targetAddress: address,
          reason,
          performedBy: 'admin',
          performedAt: new Date(),
        },
      });

      return auditEntry;
    });

    if (!result) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await cache.invalidatePrefix(`admin:user:${address}`);
    res.json({ message: `User ${address} banned.`, auditEntry: result });
  } catch (err) {
    logControllerError('admin.banUser', err, req);
    res.status(500).json({ error: err.message });
  }
};

// ── Disputes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/disputes
 * Returns a paginated list of all disputes.
 */
const listDisputes = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { resolved } = req.query;

    const where =
      resolved === 'true'
        ? { resolvedAt: { not: null } }
        : resolved === 'false'
          ? { resolvedAt: null }
          : {};

    const cacheKey = `admin:disputes:${stableStringify({ limit, page, where })}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [disputes, total] = await prisma.$transaction([
      prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { raisedAt: 'desc' },
        include: {
          escrow: {
            select: {
              clientAddress: true,
              freelancerAddress: true,
              totalAmount: true,
              status: true,
            },
          },
        },
      }),
      prisma.dispute.count({ where }),
    ]);

    const result = buildPaginatedResponse(d