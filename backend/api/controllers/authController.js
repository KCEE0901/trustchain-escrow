/**
 * Auth Controller — Wallet Signature Verification
 *
 * Implements challenge-response authentication for Stellar wallet addresses and
 * issues short-lived JWTs with optional server-side session tracking.
 */

import crypto, { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import prisma from '../../lib/prisma.js';
import sessionService from '../../services/sessionService.js';
import refreshTokenService from '../../services/refreshTokenService.js';
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

function error(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function signAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      type: 'access',
    },
    process.env.JWT_ACCESS_SECRET || 'fallback_access_secret',
    { expiresIn: process.env.JWT_ACCESS_EXPIRATION || '15m' },
  );
}

export const login = async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || req.body.tenantId;
    const { email, password } = req.body;

    if (!tenantId || !email || !password) {
      return error(res, 400, 'INVALID_REQUEST', 'tenant, email, and password are required');
    }

    const user = await prisma.user.findFirst({ where: { tenantId, email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return error(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const accessToken = signAccessToken(user);
    const refresh = await refreshTokenService.createRefreshToken(
      user,
      { type: 'login' },
      getClientIp(req),
      req.headers['user-agent'],
    );

    return res.json({
      accessToken,
      refreshToken: refresh.refreshToken,
      expiresAt: refresh.expiresAt,
      userId: user.id,
      tenantId: user.tenantId,
    });
  } catch (err) {
    return error(res, 500, 'LOGIN_FAILED', err.message);
  }
};

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
    return error(res, 400, 'INVALID_ADDRESS', 'Valid Stellar address required');
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
    return error(res, 400, 'INVALID_ADDRESS', 'Valid Stellar address required');
  }
  if (!signature || typeof signature !== 'string') {
    return error(res, 400, 'SIGNATURE_REQUIRED', 'Signature required');
  }

  const stored = nonceStore.get(address);
  if (!stored) {
    return error(
      res,
      401,
      'NONCE_NOT_FOUND',
      'No pending nonce for this address. Request a new one.',
    );
  }
  if (Date.now() > stored.expiresAt) {
    nonceStore.delete(address);
    return error(res, 401, 'NONCE_EXPIRED', 'Nonce expired. Request a new one.');
  }

  const valid = verifySignature(address, stored.message, signature);
  nonceStore.delete(address);

  if (!valid) {
    return error(res, 401, 'SIGNATURE_INVALID', 'Signature verification failed');
  }

  const jti = await createSessionJti(address, req);
  const token = jwt.sign({ address, jti, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });

  return res.json({ token, address, expiresIn: JWT_EXPIRES_IN });
};

export const refreshToken = async (req, res) => {
  if (req.body?.refreshToken) {
    try {
      const tokens = await refreshTokenService.rotateRefreshToken(
        req.body.refreshToken,
        { type: 'explicit_refresh' },
        getClientIp(req),
        req.headers['user-agent'],
      );
      return res.json(tokens);
    } catch (err) {
      return error(res, 403, 'REFRESH_TOKEN_INVALID', err.message);
    }
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return error(res, 401, 'TOKEN_REQUIRED', 'Bearer token or refreshToken required');
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
    return error(res, 401, 'TOKEN_INVALID', 'Invalid or expired token');
  }
};

export const logout = async (req, res) => {
  if (req.body?.refreshToken) {
    await refreshTokenService.revokeRefreshToken(req.body.refreshToken, 'logout');
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

  return res.json({ ok: true });
};

export const listSessions = async (req, res) => {
  try {
    if (req.user?.userId) {
      const sessions = await refreshTokenService.getUserActiveTokens(
        req.user.userId,
        req.user.tenantId,
      );
      return res.json({ sessions, data: sessions });
    }

    const address = req.user?.address ?? req.user?.userId;
    if (!address) return error(res, 401, 'AUTH_REQUIRED', 'Authentication required');

    const sessions =
      typeof sessionService?.listSessions === 'function'
        ? await sessionService.listSessions(address)
        : [];
    return res.json({ sessions, data: sessions });
  } catch (err) {
    return error(res, 500, 'REQUEST_FAILED', err.message);
  }
};

export const revokeSession = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return error(res, 400, 'SESSION_ID_REQUIRED', 'Session id required');
    if (typeof sessionService?.revokeSession === 'function') {
      await sessionService.revokeSession(id);
    }
    return res.json({ ok: true });
  } catch (err) {
    return error(res, 500, 'REQUEST_FAILED', err.message);
  }
};

export const revokeAllSessions = async (req, res) => {
  try {
    const address = req.user?.address ?? req.user?.userId;
    if (!address) return error(res, 401, 'AUTH_REQUIRED', 'Authentication required');

    if (req.user?.userId) {
      await refreshTokenService.revokeAllUserTokens(req.user.userId, req.user.tenantId, 'security');
    } else if (typeof sessionService?.revokeAllSessions === 'function') {
      await sessionService.revokeAllSessions(address);
    }
    return res.json({ ok: true });
  } catch (err) {
    return error(res, 500, 'REQUEST_FAILED', err.message);
  }
};

export default {
  login,
  getNonce,
  verifySignatureAndLogin,
  refreshToken,
  logout,
  listSessions,
  revokeSession,
  revokeAllSessions,
};
