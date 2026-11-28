/**
 * Tests for Refresh Token Family Compromise Audit & Revocation (Issue #198)
 *
 * Verifies that token reuse indicates compromise, triggers family revocation,
 * deactivates sibling tokens, and writes audit log events.
 */

import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import refreshTokenService from '../services/refreshTokenService.js';
import tokenBlacklistService from '../services/tokenBlacklistService.js';
import auditService, { AuditAction, AuditCategory } from '../services/auditService.js';

describe('Refresh Token Family Compromise Detection and Revocation', () => {
  let testUser;
  const tenantId = 'test-family-tenant';

  beforeAll(async () => {
    // Ensure test tenant exists
    await prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId, slug: 'family-tenant', name: 'Family Tenant', status: 'active' },
      update: {},
    });

    // Ensure test user exists
    testUser = await prisma.user.create({
      data: {
        tenantId,
        email: `compromise-test-${Date.now()}@example.com`,
        password: 'hashedpassword',
      },
    });
  });

  afterAll(async () => {
    if (testUser) {
      await prisma.refreshToken.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => null);
    }
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => null);
  });

  beforeEach(async () => {
    tokenBlacklistService.__resetForTests?.();
  });

  test('createRefreshToken should assign a familyId to the token and record', async () => {
    const tokenData = await refreshTokenService.createRefreshToken(testUser, { type: 'web' });

    expect(tokenData.refreshToken).toBeDefined();
    expect(tokenData.familyId).toBeDefined();

    const decoded = jwt.decode(tokenData.refreshToken);
    expect(decoded.familyId).toBe(tokenData.familyId);
    expect(decoded.userId).toBe(testUser.id);
  });

  test('normal token rotation should preserve familyId in the new sibling token', async () => {
    const initialToken = await refreshTokenService.createRefreshToken(testUser, { device: 'mobile' });
    const familyId = initialToken.familyId;

    const rotated = await refreshTokenService.rotateRefreshToken(initialToken.refreshToken);
    expect(rotated.refreshToken).toBeDefined();
    expect(rotated.familyId).toBe(familyId);

    const decodedNew = jwt.decode(rotated.refreshToken);
    expect(decodedNew.familyId).toBe(familyId);

    // Old token should now be blacklisted with reason 'rotation'
    const isOldBlacklisted = await tokenBlacklistService.isTokenBlacklisted(
      initialToken.refreshToken,
      'refresh',
    );
    expect(isOldBlacklisted).toBe(true);

    const oldMeta = await tokenBlacklistService.getBlacklistMetadata(
      initialToken.refreshToken,
      'refresh',
    );
    expect(oldMeta?.reason).toBe('rotation');
  });

  test('reusing an already-rotated token should trigger compromise, revoking all sibling tokens in the family', async () => {
    // 1. Create first token
    const token1 = await refreshTokenService.createRefreshToken(testUser);
    const familyId = token1.familyId;

    // 2. Legitimate user rotates token1 -> obtains token2 (sibling in same family)
    const token2 = await refreshTokenService.rotateRefreshToken(token1.refreshToken);
    expect(token2.familyId).toBe(familyId);

    // Verify token2 is active in DB and not blacklisted
    const isToken2BlacklistedBefore = await tokenBlacklistService.isTokenBlacklisted(
      token2.refreshToken,
      'refresh',
    );
    expect(isToken2BlacklistedBefore).toBe(false);

    // 3. Attacker (or intercepted request) attempts to REUSE token1
    let reuseError = null;
    try {
      await refreshTokenService.rotateRefreshToken(token1.refreshToken, {}, '192.168.1.100', 'MaliciousAgent');
    } catch (err) {
      reuseError = err;
    }

    expect(reuseError).toBeTruthy();
    expect(reuseError.message).toContain('token family revoked');

    // 4. Verify that the entire family (including sibling token2) is now revoked!
    const isToken2BlacklistedAfter = await tokenBlacklistService.isTokenBlacklisted(
      token2.refreshToken,
      'refresh',
    );
    expect(isToken2BlacklistedAfter).toBe(true);

    const isFamilyBlacklisted = await tokenBlacklistService.isFamilyBlacklisted(familyId);
    expect(isFamilyBlacklisted).toBe(true);

    // Sibling token record in DB should be deactivated
    const token2Hash = tokenBlacklistService.hashToken(token2.refreshToken);
    const token2Record = await prisma.refreshToken.findFirst({ where: { tokenHash: token2Hash } });
    expect(token2Record.isActive).toBe(false);
  });

  test('token reuse compromise should log immutable audit event with metadata', async () => {
    const token = await refreshTokenService.createRefreshToken(testUser);
    const familyId = token.familyId;

    // Rotate once
    await refreshTokenService.rotateRefreshToken(token.refreshToken);

    // Reuse rotated token
    await expect(
      refreshTokenService.rotateRefreshToken(token.refreshToken, {}, '10.0.0.5', 'TestBrowser/1.0'),
    ).rejects.toThrow(/token family revoked/);

    // Verify audit log has recorded the event
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        category: AuditCategory.AUTH,
        action: AuditAction.TOKEN_FAMILY_COMPROMISED,
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    const log = auditLogs[0];
    expect(log.action).toBe(AuditAction.TOKEN_FAMILY_COMPROMISED);
    expect(log.actor).toBe(`user:${testUser.id}`);
    expect(log.resourceId).toBe(familyId);
    expect(log.statusCode).toBe(403);
    expect(log.metadata).toHaveProperty('familyId', familyId);
    expect(log.metadata).toHaveProperty('reason', 'refresh_token_reuse_detected');
  });

  test('revokeTokenFamily should directly revoke all sibling tokens in a family', async () => {
    const token = await refreshTokenService.createRefreshToken(testUser);
    const familyId = token.familyId;

    const rotated = await refreshTokenService.rotateRefreshToken(token.refreshToken);

    // Call revokeTokenFamily directly
    await refreshTokenService.revokeTokenFamily(familyId, testUser.id, tenantId, 'manual_security_lock');

    const isFamilyRevoked = await tokenBlacklistService.isFamilyBlacklisted(familyId);
    expect(isFamilyRevoked).toBe(true);

    const isRotatedBlacklisted = await tokenBlacklistService.isTokenBlacklisted(
      rotated.refreshToken,
      'refresh',
    );
    expect(isRotatedBlacklisted).toBe(true);
  });
});
