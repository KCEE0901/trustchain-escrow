/**
 * MFA Middleware Tests
 *
 * Tests for MFA authentication middleware:
 * - MFA requirement enforcement
 * - High-value operation protection
 * - Token validation
 * - Session management
 *
 * @module tests/middleware/mfaAuth
 */

import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const mfaService = {
  requiresMfa: jest.fn(),
};
const cache = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.unstable_mockModule('../../services/mfaService.js', () => ({ default: mfaService }));
jest.unstable_mockModule('../../lib/cache.js', () => ({ default: cache }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-mfa-secret';

const { requireMfa, requireMfaForHighValue, generateMfaToken } =
  await import('../../api/middleware/mfaAuth.js');

describe('MFA Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: {
        userId: 1,
        address: 'GTEST123',
        tenantId: 'tenant-123',
      },
      tenant: {
        id: 'tenant-123',
      },
      headers: {},
      ip: '192.168.1.1',
      get: jest.fn((header) => {
        if (header === 'User-Agent') return 'Mozilla/5.0';
        return null;
      }),
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    next = jest.fn();

    jest.clearAllMocks();
  });

  describe('requireMfa', () => {
    it('should allow access when MFA not required', async () => {
      mfaService.requiresMfa.mockResolvedValue(false);

      await requireMfa(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block access when MFA required but not verified', async () => {
      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'MFA verification required',
          mfaRequired: true,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow access with valid MFA session', async () => {
      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue({
        verified: true,
        userId: 1,
        tenantId: 'tenant-123',
        method: 'TOTP',
      });
      cache.set.mockResolvedValue(true);

      await requireMfa(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalled(); // Session extended
    });

    it('should allow access with valid MFA token', async () => {
      const mfaToken = generateMfaToken(1, 'tenant-123', 'TOTP');

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);
      req.headers['x-mfa-token'] = mfaToken;
      cache.set.mockResolvedValue(true);

      await requireMfa(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.mfaVerified).toBe(true);
      expect(req.mfaMethod).toBe('TOTP');
      expect(cache.set).toHaveBeenCalledWith(
        'mfa:session:1',
        expect.objectContaining({
          verified: true,
          method: 'TOTP',
        }),
        expect.any(Number),
      );
    });

    it('should reject expired MFA token', async () => {
      const expiredToken = jwt.sign(
        { userId: 1, tenantId: 'tenant-123', type: 'mfa', method: 'TOTP' },
        process.env.MFA_JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '-1h' }, // Expired
      );

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);
      req.headers['x-mfa-token'] = expiredToken;

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid or expired MFA token',
          mfaRequired: true,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject MFA token for different user', async () => {
      const wrongUserToken = generateMfaToken(999, 'tenant-123', 'TOTP');

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);
      req.headers['x-mfa-token'] = wrongUserToken;

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid MFA token',
          mfaRequired: true,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should require authentication first', async () => {
      req.user = null;

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
          mfaRequired: false,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle missing user ID gracefully', async () => {
      req.user = { address: 'GTEST123' }; // No userId

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'User ID not found in token',
        }),
      );
    });
  });

  describe('requireMfaForHighValue', () => {
    it('should skip MFA for low-value operations', async () => {
      req.body = { amount: '100' };
      process.env.MFA_HIGH_VALUE_THRESHOLD = '10000';

      await requireMfaForHighValue(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mfaService.requiresMfa).not.toHaveBeenCalled();
    });

    it('should require MFA for high-value operations', async () => {
      req.body = { amount: '50000' };
      process.env.MFA_HIGH_VALUE_THRESHOLD = '10000';

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);

      await requireMfaForHighValue(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'MFA verification required',
          mfaRequired: true,
        }),
      );
    });

    it('should use default threshold if not configured', async () => {
      delete process.env.MFA_HIGH_VALUE_THRESHOLD;
      req.body = { amount: '5000' };

      await requireMfaForHighValue(req, res, next);

      expect(next).toHaveBeenCalled(); // Below default 10000
    });

    it('should handle amount in params', async () => {
      req.params = { amount: '50000' };
      process.env.MFA_HIGH_VALUE_THRESHOLD = '10000';

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);

      await requireMfaForHighValue(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('generateMfaToken', () => {
    it('should generate valid MFA token', () => {
      const token = generateMfaToken(1, 'tenant-123', 'TOTP');

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, process.env.MFA_JWT_SECRET);

      expect(decoded.userId).toBe(1);
      expect(decoded.tenantId).toBe('tenant-123');
      expect(decoded.method).toBe('TOTP');
      expect(decoded.type).toBe('mfa');
    });

    it('should generate token with 30 minute expiration', () => {
      const token = generateMfaToken(1, 'tenant-123', 'WEBAUTHN');

      const decoded = jwt.verify(token, process.env.MFA_JWT_SECRET);

      const expiresIn = decoded.exp - decoded.iat;
      expect(expiresIn).toBe(30 * 60); // 30 minutes in seconds
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      mfaService.requiresMfa.mockRejectedValue(new Error('Database error'));

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Internal server error during MFA verification',
        }),
      );
    });

    it('should handle cache errors gracefully', async () => {
      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockRejectedValue(new Error('Redis error'));

      await requireMfa(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Session Management', () => {
    it('should extend MFA session on each request', async () => {
      const existingSession = {
        verified: true,
        userId: 1,
        tenantId: 'tenant-123',
        method: 'TOTP',
        verifiedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      };

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(existingSession);
      cache.set.mockResolvedValue(true);

      await requireMfa(req, res, next);

      expect(cache.set).toHaveBeenCalledWith(
        'mfa:session:1',
        existingSession,
        30 * 60, // 30 minutes
      );
      expect(next).toHaveBeenCalled();
    });

    it('should create new session from MFA token', async () => {
      const mfaToken = generateMfaToken(1, 'tenant-123', 'WEBAUTHN');

      mfaService.requiresMfa.mockResolvedValue(true);
      cache.get.mockResolvedValue(null);
      req.headers['x-mfa-token'] = mfaToken;
      cache.set.mockResolvedValue(true);

      await requireMfa(req, res, next);

      expect(cache.set).toHaveBeenCalledWith(
        'mfa:session:1',
        expect.objectContaining({
          verified: true,
          userId: 1,
          tenantId: 'tenant-123',
          method: 'WEBAUTHN',
        }),
        30 * 60,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge-case additions — issues #217
// Appended below the original test suite; no existing tests were modified.
// ─────────────────────────────────────────────────────────────────────────────

describe('requireMfa — token edge cases', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { userId: 1, address: 'GTEST123', tenantId: 'tenant-123' },
      tenant: { id: 'tenant-123' },
      headers: {},
      ip: '127.0.0.1',
      get: jest.fn((h) => (h === 'User-Agent' ? 'TestAgent/1.0' : null)),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should return 403 with mfaRequired:true when x-mfa-token is an empty string', async () => {
    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    req.headers['x-mfa-token'] = '';

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mfaRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when x-mfa-token is a non-string value (number)', async () => {
    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    req.headers['x-mfa-token'] = 12345;

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when x-mfa-token header is completely absent', async () => {
    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    // Deliberately no x-mfa-token key set on headers

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mfaRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 with "Invalid or expired MFA token" for a malformed JWT string', async () => {
    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    req.headers['x-mfa-token'] = 'not.a.jwt';

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringMatching(/invalid or expired mfa token/i),
        mfaRequired: true,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 with "Invalid MFA token" when token type is "access" instead of "mfa"', async () => {
    const wrongTypeToken = jwt.sign(
      { userId: 1, tenantId: 'tenant-123', type: 'access', method: 'TOTP' },
      process.env.MFA_JWT_SECRET || process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '30m' },
    );

    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    req.headers['x-mfa-token'] = wrongTypeToken;

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringMatching(/invalid mfa token/i),
        mfaRequired: true,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should still require MFA when cache returns a session with verified:false', async () => {
    mfaService.requiresMfa.mockResolvedValue(true);
    cache.get.mockResolvedValue({ verified: false, userId: 1, tenantId: 'tenant-123' });

    await requireMfa(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mfaRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireMfaForHighValue — threshold boundary cases', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { userId: 1, address: 'GTEST123', tenantId: 'tenant-123' },
      tenant: { id: 'tenant-123' },
      headers: {},
      body: {},
      params: {},
      ip: '127.0.0.1',
      get: jest.fn((h) => (h === 'User-Agent' ? 'TestAgent/1.0' : null)),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    jest.clearAllMocks();
    process.env.MFA_HIGH_VALUE_THRESHOLD = '10000';
  });

  it('should skip MFA when amount is zero (below threshold)', async () => {
    req.body = { amount: '0' };

    await requireMfaForHighValue(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mfaService.requiresMfa).not.toHaveBeenCalled();
  });

  it('should skip MFA when amount equals the threshold exactly (not strictly greater)', async () => {
    req.body = { amount: '10000' };

    await requireMfaForHighValue(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mfaService.requiresMfa).not.toHaveBeenCalled();
  });
});
