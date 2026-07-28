/**
 * Auth Middleware
 *
 * Validates Bearer JWT and checks jti against the session store.
 * Attaches req.user = { address, jti } on success.
 */

import jwt from 'jsonwebtoken';
import sessionService from '../../services/sessionService.js';
import { JWT_SECRET, JWT_ALGORITHM } from '../../config/secrets.js';
import tokenBlacklistService from '../../services/tokenBlacklistService.js';

export default async function authMiddleware(req, res, next) {
  if (req.isAdmin) {
    req.user = req.user ?? { address: req.adminId ?? 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);

  try {
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'fallback_access_secret');
    } catch {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    }

    if (payload.type && payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    if (await tokenBlacklistService.isTokenBlacklisted(token, 'access')) {
      return res.status(403).json({ error: 'Token has been revoked for security reasons' });
    }

    if (payload.jti) {
      const valid = await sessionService.isSessionValid(payload.jti);
      if (!valid) {
        return res.status(401).json({ error: 'Session revoked or expired. Please log in again.' });
      }
    }

    req.user = {
      address: payload.address,
      jti: payload.jti,
      userId: payload.userId,
      tenantId: payload.tenantId,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}
