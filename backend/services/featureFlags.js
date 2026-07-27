/**
 * Feature Flags Service
 *
 * Tenant-aware feature flag evaluation with percentage rollout and explicit
 * user targeting. Supports both global flags and tenant-scoped overrides so
 * that individual tenants can opt-in or opt-out of features independently of
 * the platform-wide rollout configuration.
 *
 * @module services/featureFlags
 */

import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { log, AuditCategory } from './auditService.js';

/**
 * Deterministic hash of userId + flagKey → integer 0–99.
 * Same user always gets the same bucket for a given flag.
 */
function hashBucket(userId, flagKey) {
  const hash = crypto.createHash('sha256').update(`${userId}:${flagKey}`).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 100;
}

/**
 * Evaluate whether a feature flag is active for a given user context.
 *
 * Evaluation order:
 *  1. Tenant-level override exists and overrides the flag → use tenant value
 *  2. Flag disabled globally → false (unless user is explicitly targeted)
 *  3. User explicitly in targetUsers → true
 *  4. User's hash bucket < percentage → true
 *  5. Otherwise → false
 *
 * @param {string} flagKey
 * @param {{ id: string|number, tenantId?: string|number }} userContext
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(flagKey, userContext) {
  const flag = await prisma.featureFlag.findUnique({ where: { key: flagKey } });
  if (!flag) return false;

  // Check for tenant-level override first
  if (userContext.tenantId) {
    const tenantOverride = await getTenantFlagOverride(flagKey, String(userContext.tenantId));
    if (tenantOverride !== null) {
      return tenantOverride;
    }
  }

  if (!flag.isEnabled) {
    // Still allow explicitly targeted users even when globally disabled
    return flag.targetUsers.includes(String(userContext.id));
  }
  if (flag.targetUsers.includes(String(userContext.id))) return true;
  return hashBucket(String(userContext.id), flagKey) < flag.percentage;
}

/**
 * Get a tenant-level override for a flag, if one exists.
 * Returns null when no override is set (fall through to global flag).
 *
 * @param {string} flagKey
 * @param {string} tenantId
 * @returns {Promise<boolean|null>}
 */
async function getTenantFlagOverride(flagKey, tenantId) {
  try {
    const override = await prisma.tenantFeatureFlagOverride.findUnique({
      where: { tenantId_flagKey: { tenantId, flagKey } },
    });
    return override ? override.isEnabled : null;
  } catch {
    // tenantFeatureFlagOverride table may not exist yet — return null gracefully
    return null;
  }
}

/**
 * List all flag states for a specific tenant, merging global flags with
 * any tenant-level overrides.
 *
 * @param {string} tenantId
 * @returns {Promise<Array<{ key: string, isEnabled: boolean, source: 'tenant'|'global' }>>}
 */
export async function listFlagsForTenant(tenantId) {
  const [globalFlags, overrides] = await Promise.all([
    prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }),
    prisma.tenantFeatureFlagOverride
      .findMany({ where: { tenantId } })
      .catch(() => []), // table may not exist yet
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.flagKey, o.isEnabled]));

  return globalFlags.map((flag) => {
    const hasOverride = overrideMap.has(flag.key);
    return {
      key: flag.key,
      description: flag.description,
      isEnabled: hasOverride ? overrideMap.get(flag.key) : flag.isEnabled,
      percentage: flag.percentage,
      source: hasOverride ? 'tenant' : 'global',
    };
  });
}

/**
 * Set a tenant-level override for a feature flag.
 *
 * @param {string} flagKey
 * @param {string} tenantId
 * @param {boolean} isEnabled
 * @param {string} adminId  - who made the change (for audit)
 */
export async function setTenantFlagOverride(flagKey, tenantId, isEnabled, adminId) {
  await prisma.tenantFeatureFlagOverride.upsert({
    where: { tenantId_flagKey: { tenantId, flagKey } },
    create: { tenantId, flagKey, isEnabled },
    update: { isEnabled },
  }).catch(async () => {
    // If the model doesn't exist yet, log a warning but don't crash
    console.warn('[FeatureFlags] tenantFeatureFlagOverride model unavailable — skipping upsert');
  });

  await _auditFlagChange('TENANT_FLAG_OVERRIDE_SET', flagKey, adminId, {
    tenantId,
    isEnabled,
  });
}

/**
 * Remove a tenant-level override, reverting the tenant to global behaviour.
 *
 * @param {string} flagKey
 * @param {string} tenantId
 * @param {string} adminId
 */
export async function removeTenantFlagOverride(flagKey, tenantId, adminId) {
  await prisma.tenantFeatureFlagOverride.delete({
    where: { tenantId_flagKey: { tenantId, flagKey } },
  }).catch(() => {}); // no-op if override didn't exist

  await _auditFlagChange('TENANT_FLAG_OVERRIDE_REMOVED', flagKey, adminId, { tenantId });
}

/**
 * Return all flags (for admin listing).
 */
export async function listFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
}

/**
 * Create a new feature flag.
 */
export async function createFlag(
  { key, isEnabled = false, percentage = 0, targetUsers = [], description = '' },
  adminId,
) {
  const flag = await prisma.featureFlag.create({
    data: { key, isEnabled, percentage, targetUsers, description },
  });
  await _auditFlagChange('FLAG_CREATED', flag.key, adminId, { isEnabled, percentage });
  return flag;
}

/**
 * Update an existing flag. Logs every change.
 */
export async function updateFlag(key, patch, adminId) {
  const flag = await prisma.featureFlag.update({
    where: { key },
    data: patch,
  });
  await _auditFlagChange('FLAG_UPDATED', key, adminId, patch);
  return flag;
}

/**
 * Delete a flag.
 */
export async function deleteFlag(key, adminId) {
  await prisma.featureFlag.delete({ where: { key } });
  await _auditFlagChange('FLAG_DELETED', key, adminId, {});
}

async function _auditFlagChange(action, flagKey, adminId, changes) {
  await log({
    category: AuditCategory.ADMIN,
    action,
    actor: String(adminId ?? 'admin'),
    resourceId: flagKey,
    metadata: changes,
  });
}
