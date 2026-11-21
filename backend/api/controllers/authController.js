/**
 * Auth Controller — Wallet Signature Verification
 *
 * Implements challenge-response authentication for Stellar wallet addresses and
 * issues short-lived JWTs with optional server-side session tracking.
 */

import crypto, { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import prisma from '../../lib/prisma.js';
import sessionService from '../../services/sessionService.js';
import refreshTokenService from '../../services/refreshTokenService.js';
import tokenMetricsService from '../../services/tokenMetricsService.js';
import { JWT_SECRET, JWT_ALGORITHM } from '../../config/secrets.js';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const NONCE_TTL_MS = 5 * 60 * 1000;

const nonceStore = new Map();

function isValidStellarAddress(address) {
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function buildChallengeMessage(address, nonce) {
  return `Sign this message to authenticate with StellarTrustEscrow.\n\nAddress: ${address}\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;
}

function verifySignature(address, message, signature) {
  try {
    return Keypair.fromPublicKey(address).verify(
      Buffer.from(message, 'utf8'),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? '';
}

async function createSessionJti(address, req) {
  if (typeof sessionService?.createSession !== 'function') {
    return randomUUID();
  }

  return sessionService.createSession({
    address,
    userAgent: req.headers['user-agent'],
    ipAddress: getClientIp(req),
    expiresIn: JWT_EXPIRES_IN,
  });
}

export const getNonce = (req, res) => {
  const { address } = req.body;

  if (!address || !isValidStellarAddress(address)) {
    return res.status(400).json({ error: 'Valid Stellar address required' });
  }

  const nonce = generateNonce();
  const message = buildChallengeMessage(address, nonce);
  const expiresAt = Date.now() + NONCE_TTL_MS;

  nonceStore.set(address, { nonce, message, expiresAt });
  setTimeout(() => nonceStore.delete(address), NONCE_TTL_MS);

  return res.json({ address, nonce, message, expiresIn: NONCE_TTL_MS / 1000 });
};

export const verifySignatureAndLogin = async (req, res) => {
  const { address, signature } = req.body;

  if (!address || !isValidStellarAddress(address)) {
    return res.status(400).json({ error: 'Valid Stellar address required' });
  }
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Signature required' });
  }

  const stored = nonceStore.get(address);
  if (!stored) {
    return res.status(401).json({ error: 'No pending nonce for this address. Request a new one.' });
  }
  if (Date.now() > stored.expiresAt) {
    nonceStore.delete(address);
    return res.status(401).json({ error: 'Nonce expired. Request a new one.' });
  }

  const valid = verifySignature(address, stored.message, signature);
  nonceStore.delete(address);

  if (!valid) {
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  const jti = await createSessionJti(address, req);
  const token = jwt.sign({ address, jti, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });

  return res.json({ token, address, expiresIn: JWT_EXPIRES_IN });
};

export const register = async (req, res) => {
  try {
    const { email, password, walletAddress } = req.body;
    const tenantId = req.tenant?.id;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant context is required' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findFirst({
      where: { email, tenantId },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        walletAddress: walletAddress || null,
        password: hashedPassword,
      },
    });

    return res.status(201).json({
      message: 'User registered successfully',
      userId: user.id,
      tenant: { id: req.tenant.id, slug: req.tenant.slug },
    });
  } catch (error) {
    console.error('[Register] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const tenantId = req.tenant?.id;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant context is required' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await prisma.user.findFirst({
      where: { email, tenantId },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate access token
    const accessToken = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        type: 'access',
      },
      process.env.JWT_ACCESS_SECRET || 'fallback_access_secret',
      { expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m' },
    );

    // Create refresh token with family support
    const deviceInfo = {
      type: 'web',
      trustLevel: 'trusted',
    };

    const refreshTokenData = await refreshTokenService.createRefreshToken(
      user,
      deviceInfo,
      req.ip,
      req.get('User-Agent'),
    );

    // Record metrics
    if (tokenMetricsService?.recordTokenGeneration) {
      await tokenMetricsService.recordTokenGeneration(user.id, user.tenantId, 'access', deviceInfo).catch(() => null);
      await tokenMetricsService.recordTokenGeneration(user.id, user.tenantId, 'refresh', deviceInfo).catch(() => null);
    }

    return res.json({
      accessToken,
      refreshToken: refreshTokenData.refreshToken,
      userId: user.id,
      tenant: { id: req.tenant.id, slug: req.tenant.slug },
    });
  } catch (error) {
    console.error('[Login] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const refreshToken = async (req, res) => {
  // Support POST /api/auth/refresh with body { refreshToken }
  if (req.body?.refreshToken) {
    const { refreshToken: tokenStr } = req.body;
    const tenantId = req.tenant?.id;

    if (!tokenStr) {
      return res.status(401).json({ error: 'Refresh token is required' });
    }

    const deviceInfo = {
      type: 'web',
      trustLevel: 'trusted',
    };

    try {
      const tokens = await refreshTokenService.rotateRefreshToken(
        tokenStr,
        deviceInfo,
        req.ip,
        req.get('User-Agent'),
      );

      const decoded = jwt.decode(tokens.accessToken);
      if (tokenMetricsService?.recordTokenRefresh && decoded) {
        await tokenMetricsService.recordTokenRefresh(decoded.userId, decoded.tenantId, true, 'rotation').catch(() => null);
        await tokenMetricsService.recordTokenGeneration(decoded.userId, decoded.tenantId, 'access', deviceInfo).catch(() => null);
      }

      return res.json(tokens);
    } catch (error) {
      console.error('[Refresh] Error:', error.message);
      if (
        error.message.includes('blacklisted') ||
        error.message.includes('compromise') ||
        error.message.includes('reuse')
      ) {
        if (tokenMetricsService?.recordSuspiciousActivity) {
          await tokenMetricsService.recordSuspiciousActivity(
            'unknown',
            tenantId,
            'compromised_refresh_token',
            { error: error.message },
          ).catch(() => null);
        }
        return res.status(403).json({ error: 'Token has been revoked for security reasons' });
      }
      if (
        error.message.includes('Invalid') ||
        error.message.includes('expired') ||
        error.message.includes('not found')
      ) {
        if (tokenMetricsService?.recordTokenRefresh) {
          await tokenMetricsService.recordTokenRefresh('unknown', tenantId, false, error.message).catch(() => null);
        }
        return res.status(403).json({ error: 'Invalid or expired refresh token' });
      }
      if (error.message.includes('revoked')) {
        return res.status(403).json({ error: 'All tokens have been revoked' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Fallback: Authorization header Bearer token refresh
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    if (payload.jti && typeof sessionService?.revokeSession === 'function') {
      await sessionService.revokeSession(payload.jti);
    }

    const jti = await createSessionJti(payload.address, req);
    const token = jwt.sign({ address: payload.address, jti }, JWT_SECRET, {
      algorithm: JWT_ALGORITHM,
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.json({ token, address: payload.address, expiresIn: JWT_EXPIRES_IN });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const logout = async (req, res) => {
  const { refreshToken: tokenStr } = req.body || {};
  const tenantId = req.tenant?.id;

  if (tokenStr) {
    try {
      await refreshTokenService.revokeRefreshToken(tokenStr, 'logout');
      if (tokenMetricsService?.recordTokenRevocation) {
        await tokenMetricsService.recordTokenRevocation('unknown', tenantId, 'logout').catch(() => null);
      }
    } catch (err) {
      console.error('[Logout] Revoke token failed:', err.message);
    }
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
      if (payload.jti && typeof sessionService?.revokeSession === 'function') {
        await sessionService.revokeSession(payload.jti);
      }
    } catch {
      // Logout is idempotent; invalid tokens are treated as already logged out.
    }
  }

  return res.json({ ok: true, message: 'Logged out successfully' });
};

export const revokeAll = async (req, res) => {
  try {
    const tenantId = req.tenant?.id;
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await refreshTokenService.revokeAllUserTokens(userId, tenantId, 'user_request');
    if (tokenMetricsService?.recordTokenRevocation) {
      await tokenMetricsService.recordTokenRevocation(userId, tenantId, 'user_request').catch(() => null);
    }

    return res.json({ message: 'All tokens revoked successfully' });
  } catch (error) {
    console.error('[RevokeAll] Error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const listSessions = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const address = req.user?.address;

    if (!userId && !address) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (userId) {
      const activeTokens = await refreshTokenService.getUserActiveTokens(userId, req.tenant?.id);
      return res.json({
        sessions: activeTokens.map((token) => ({
          id: token.id,
          deviceInfo: token.deviceInfo,
          ipAddress: token.ipAddress,
          userAgent: token.userAgent,
          createdAt: token.createdAt,
          lastUsedAt: token.lastUsedAt,
          expiresAt: token.expiresAt,
        })),
      });
    }

    const sessions =
      typeof sessionService?.listSessions === 'function'
        ? await sessionService.listSessions(address)
        : [];
    return res.json({ data: sessions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const revokeSession = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Session id required' });
    if (typeof sessionService?.revokeSession === 'function') {
      await sessionService.revokeSession(id);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const revokeAllSessions = async (req, res) => {
  try {
    const address = req.user?.address ?? req.user?.userId;
    if (!address) return res.status(401).json({ error: 'Authentication required' });

    if (typeof sessionService?.revokeAllSessions === 'function') {
      await sessionService.revokeAllSessions(address);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export default {
  getNonce,
  verifySignatureAndLogin,
  register,
  login,
  refreshToken,
  logout,
  revokeAll,
  listSessions,
  revokeSession,
  revokeAllSessions,
};
