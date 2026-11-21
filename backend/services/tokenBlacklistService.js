/**
 * Token Blacklist Service
 *
 * Provides Redis-based token blacklisting for immediate revocation of compromised tokens.
 * Supports both access tokens and refresh tokens with TTL-based expiration.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import cacheService from './cacheService.js';
import { withTenantScopeBypassed } from '../lib/tenantContext.js';

const BLACKLIST_PREFIX = 'blacklist:';
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days

export const CLEANUP_POLICY = Object.freeze({
  intervalMs: 60 * 60 * 1000, // hourly
  maxBatchSize: 1000,
  retentionBufferSeconds: 0,
});

/** In-memory registry to track active blacklist entries across backends */
const blacklistRegistry = new Map();
let cleanupTimer = null;

/**
 * Create a SHA-256 hash of a token for secure storage
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Add a token to the blacklist
 * @param {string} token - The JWT token to blacklist
 * @param {string} type - 'access' or 'refresh'
 * @param {string} reason - Reason for blacklisting
 * @param {number} [customTtl] - Optional custom TTL in seconds
 */
async function blacklistToken(token, type = 'access', reason = 'compromised', customTtl = null) {
  const tokenHash = hashToken(token);
  const key = `${BLACKLIST_PREFIX}${type}:${tokenHash}`;

  const ttl = customTtl !== null ? customTtl : type === 'access' ? ACCESS_TOKEN_TTL : REFRESH_TOKEN_TTL;
  const expiresAtDate = new Date(Date.now() + ttl * 1000);
  const metadata = {
    blacklistedAt: new Date().toISOString(),
    reason,
    type,
    expiresAt: expiresAtDate.toISOString(),
  };

  blacklistRegistry.set(key, {
    key,
    type,
    tokenHash,
    reason,
    expiresAt: expiresAtDate,
  });

  await withTenantScopeBypassed(() => cacheService.set(key, metadata, Math.max(ttl, 1)));

  console.log(`[TokenBlacklist] Token blacklisted: ${type} - ${reason}`);
  return true;
}

/**
 * Blacklist an entire refresh token family
 * @param {string} familyId - The token family identifier
 * @param {number} [userId] - Optional user ID
 * @param {string} [tenantId] - Optional tenant ID
 * @param {string} [reason] - Reason for revocation
 */
async function blacklistTokenFamily(familyId, userId = null, tenantId = null, reason = 'family_compromise') {
  if (!familyId) return false;
  const key = `${BLACKLIST_PREFIX}family:${familyId}`;
  const ttl = REFRESH_TOKEN_TTL;
  const expiresAtDate = new Date(Date.now() + ttl * 1000);
  const metadata = {
    blacklistedAt: new Date().toISOString(),
    reason,
    familyId,
    userId,
    tenantId,
    expiresAt: expiresAtDate.toISOString(),
  };

  blacklistRegistry.set(key, {
    key,
    type: 'family',
    familyId,
    reason,
    expiresAt: expiresAtDate,
  });

  await withTenantScopeBypassed(() => cacheService.set(key, metadata, ttl));
  console.log(`[TokenBlacklist] Token family blacklisted: ${familyId} - ${reason}`);
  return true;
}

/**
 * Check if a token family is blacklisted
 * @param {string} familyId
 */
async function isFamilyBlacklisted(familyId) {
  if (!familyId) return false;
  const key = `${BLACKLIST_PREFIX}family:${familyId}`;
  const meta = await withTenantScopeBypassed(() => cacheService.get(key));
  return meta !== null;
}

/**
 * Check if a token is blacklisted
 * @param {string} token - The JWT token to check
 * @param {string} type - 'access' or 'refresh'
 */
async function isTokenBlacklisted(token, type = 'access') {
  const tokenHash = hashToken(token);
  const key = `${BLACKLIST_PREFIX}${type}:${tokenHash}`;

  const blacklisted = await withTenantScopeBypassed(() => cacheService.get(key));
  if (blacklisted !== null) {
    return true;
  }

  const decoded = jwt.decode(token);
  if (type === 'refresh') {
    if (decoded?.familyId) {
      const familyRevoked = await isFamilyBlacklisted(decoded.familyId);
      if (familyRevoked) return true;
    }
    if (decoded?.userId && decoded?.tenantId) {
      return areAllUserTokensBlacklisted(decoded.userId, decoded.tenantId);
    }
  }

  return false;
}

/**
 * Get blacklist metadata for a token
 * @param {string} token - The JWT token
 * @param {string} type - 'access' or 'refresh'
 */
async function getBlacklistMetadata(token, type = 'access') {
  const tokenHash = hashToken(token);
  const key = `${BLACKLIST_PREFIX}${type}:${tokenHash}`;

  const metadata = await withTenantScopeBypassed(() => cacheService.get(key));
  if (metadata) {
    return metadata;
  }

  const decoded = jwt.decode(token);
  if (type === 'refresh') {
    if (decoded?.familyId) {
      const familyMeta = await withTenantScopeBypassed(() =>
        cacheService.get(`${BLACKLIST_PREFIX}family:${decoded.familyId}`),
      );
      if (familyMeta) return familyMeta;
    }
    if (decoded?.userId && decoded?.tenantId) {
      const allTokensMetadata = await withTenantScopeBypassed(() =>
        cacheService.get(`${BLACKLIST_PREFIX}user:${decoded.tenantId}:${decoded.userId}`),
      );
      if (allTokensMetadata) {
        return allTokensMetadata;
      }
    }
  }

  return null;
}

/**
 * Remove a token from the blacklist (if needed)
 * @param {string} token - The JWT token to remove
 * @param {string} type - 'access' or 'refresh'
 */
async function removeFromBlacklist(token, type = 'access') {
  const tokenHash = hashToken(token);
  const key = `${BLACKLIST_PREFIX}${type}:${tokenHash}`;

  blacklistRegistry.delete(key);
  await withTenantScopeBypassed(() => cacheService.invalidate(key));
  console.log(`[TokenBlacklist] Token removed from blacklist: ${type}`);
  return true;
}

/**
 * Blacklist all tokens for a user (emergency logout)
 * @param {number} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @param {string} reason - Reason for blacklisting
 */
async function blacklistAllUserTokens(userId, tenantId, reason = 'security_incident') {
  const key = `${BLACKLIST_PREFIX}user:${tenantId}:${userId}`;
  const expiresAtDate = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  const metadata = {
    blacklistedAt: new Date().toISOString(),
    reason,
    allTokens: true,
    expiresAt: expiresAtDate.toISOString(),
  };

  blacklistRegistry.set(key, {
    key,
    type: 'user_all',
    userId,
    tenantId,
    reason,
    expiresAt: expiresAtDate,
  });

  await withTenantScopeBypassed(() => cacheService.set(key, metadata, REFRESH_TOKEN_TTL));
  console.log(`[TokenBlacklist] All tokens blacklisted for user ${userId} in tenant ${tenantId}`);
  return true;
}

/**
 * Check if all tokens for a user are blacklisted
 * @param {number} userId - User ID
 * @param {string} tenantId - Tenant ID
 */
async function areAllUserTokensBlacklisted(userId, tenantId) {
  const key = `${BLACKLIST_PREFIX}user:${tenantId}:${userId}`;
  const blacklisted = await withTenantScopeBypassed(() => cacheService.get(key));
  return blacklisted !== null;
}

/**
 * Clean up expired blacklist entries so logout/revocation storage remains bounded.
 * Removes expired items from both cache and internal registry and logs count.
 *
 * @param {object} [options]
 * @param {Date} [options.now] - Effective current time for expiration check
 * @returns {Promise<{ deletedCount: number, remainingCount: number, cleanedKeys: string[] }>}
 */
async function cleanupExpiredEntries({ now = new Date() } = {}) {
  let deletedCount = 0;
  const cleanedKeys = [];
  const effectiveNow = now instanceof Date ? now : new Date(now);

  for (const [key, entry] of blacklistRegistry.entries()) {
    const expiresAt = entry.expiresAt instanceof Date ? entry.expiresAt : new Date(entry.expiresAt);
    if (expiresAt <= effectiveNow) {
      await withTenantScopeBypassed(() => cacheService.invalidate(key));
      blacklistRegistry.delete(key);
      cleanedKeys.push(key);
      deletedCount++;
    }
  }

  console.log(`[TokenBlacklist] Cleaned up ${deletedCount} expired blacklist entries`);
  return {
    deletedCount,
    remainingCount: blacklistRegistry.size,
    cleanedKeys,
  };
}

/**
 * Start the scheduled background cleanup job based on policy
 */
function startBlacklistCleanupJob(intervalMs = CLEANUP_POLICY.intervalMs) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(async () => {
    try {
      await cleanupExpiredEntries();
    } catch (err) {
      console.error('[TokenBlacklist] Background cleanup failed:', err.message);
    }
  }, intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Stop the background cleanup job
 */
function stopBlacklistCleanupJob() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Reset tracked entries for test suites
 */
function __resetForTests() {
  blacklistRegistry.clear();
  stopBlacklistCleanupJob();
}

/**
 * Get blacklist statistics for monitoring
 */
async function getBlacklistStats() {
  return {
    backend: cacheService.analytics().backend,
    trackedEntries: blacklistRegistry.size,
    policy: CLEANUP_POLICY,
    message: 'Blacklist storage bounded by TTL and active cleanup policy',
  };
}

export default {
  blacklistToken,
  blacklistTokenFamily,
  isFamilyBlacklisted,
  isTokenBlacklisted,
  getBlacklistMetadata,
  removeFromBlacklist,
  blacklistAllUserTokens,
  areAllUserTokensBlacklisted,
  cleanupExpiredEntries,
  startBlacklistCleanupJob,
  stopBlacklistCleanupJob,
  getBlacklistStats,
  hashToken,
  CLEANUP_POLICY,
  __resetForTests,
};
