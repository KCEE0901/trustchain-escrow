/**
 * Tests for Token Blacklist Cleanup Policy (Issue #189)
 *
 * Verifies that expired token blacklist rows are cleaned up so logout/revocation
 * storage remains bounded, active entries are preserved, and deleted count is logged.
 */

import jwt from 'jsonwebtoken';
import tokenBlacklistService, { CLEANUP_POLICY } from '../services/tokenBlacklistService.js';

describe('Token Blacklist Cleanup Policy', () => {
  const secret = 'test-cleanup-jwt-secret';

  function createTestToken(userId, expiresInSeconds = 900) {
    return jwt.sign(
      { userId, tenantId: 'tenant-test', type: 'access' },
      secret,
      { expiresIn: `${expiresInSeconds}s` },
    );
  }

  beforeEach(() => {
    tokenBlacklistService.__resetForTests?.();
  });

  afterEach(() => {
    tokenBlacklistService.stopBlacklistCleanupJob();
  });

  test('should define cleanup policy with bounded execution parameters', () => {
    expect(CLEANUP_POLICY).toBeDefined();
    expect(CLEANUP_POLICY.intervalMs).toBeGreaterThan(0);
    expect(CLEANUP_POLICY.maxBatchSize).toBeGreaterThan(0);
  });

  test('cleanup job should delete expired entries and retain active entries', async () => {
    const activeToken1 = createTestToken(101, 3600);
    const activeToken2 = createTestToken(102, 3600);
    const expiredToken1 = createTestToken(201, 60);
    const expiredToken2 = createTestToken(202, 60);

    // Blacklist active tokens with TTL of 1 hour (3600s)
    await tokenBlacklistService.blacklistToken(activeToken1, 'access', 'logout', 3600);
    await tokenBlacklistService.blacklistToken(activeToken2, 'access', 'logout', 3600);

    // Blacklist tokens with TTL of 10 seconds (to simulate expiring soon)
    await tokenBlacklistService.blacklistToken(expiredToken1, 'access', 'logout', 10);
    await tokenBlacklistService.blacklistToken(expiredToken2, 'access', 'logout', 10);

    // Verify all 4 tokens are blacklisted initially
    expect(await tokenBlacklistService.isTokenBlacklisted(activeToken1, 'access')).toBe(true);
    expect(await tokenBlacklistService.isTokenBlacklisted(activeToken2, 'access')).toBe(true);
    expect(await tokenBlacklistService.isTokenBlacklisted(expiredToken1, 'access')).toBe(true);
    expect(await tokenBlacklistService.isTokenBlacklisted(expiredToken2, 'access')).toBe(true);

    // Spy on console.log to verify count logging
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Run cleanup simulating 30 seconds into the future (so the 10s tokens are expired)
    const futureDate = new Date(Date.now() + 30 * 1000);
    const cleanupResult = await tokenBlacklistService.cleanupExpiredEntries({ now: futureDate });

    expect(cleanupResult.deletedCount).toBe(2);
    expect(cleanupResult.remainingCount).toBe(2);

    // Verify log message contains the deleted count
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TokenBlacklist] Cleaned up 2 expired blacklist entries'),
    );

    consoleSpy.mockRestore();

    // Verify expired tokens were removed from blacklist
    expect(await tokenBlacklistService.isTokenBlacklisted(expiredToken1, 'access')).toBe(false);
    expect(await tokenBlacklistService.isTokenBlacklisted(expiredToken2, 'access')).toBe(false);

    // Verify active tokens REMAIN blacklisted!
    expect(await tokenBlacklistService.isTokenBlacklisted(activeToken1, 'access')).toBe(true);
    expect(await tokenBlacklistService.isTokenBlacklisted(activeToken2, 'access')).toBe(true);
  });

  test('cleanup job with zero expired entries deletes nothing and leaves entries intact', async () => {
    const activeToken = createTestToken(301, 7200);
    await tokenBlacklistService.blacklistToken(activeToken, 'access', 'admin_revocation', 7200);

    const result = await tokenBlacklistService.cleanupExpiredEntries({ now: new Date() });
    expect(result.deletedCount).toBe(0);
    expect(result.remainingCount).toBe(1);

    expect(await tokenBlacklistService.isTokenBlacklisted(activeToken, 'access')).toBe(true);
  });

  test('startBlacklistCleanupJob and stopBlacklistCleanupJob manage timer lifecycle correctly', () => {
    tokenBlacklistService.startBlacklistCleanupJob(5000);
    // Should be able to stop without error
    expect(() => tokenBlacklistService.stopBlacklistCleanupJob()).not.toThrow();
  });
});
