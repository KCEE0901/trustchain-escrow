import express from 'express';
import authController from '../controllers/authController.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

/** POST /api/auth/register — email/password user registration */
router.post('/register', authController.register);

/** POST /api/auth/login — email/password user login */
router.post('/login', authController.login);

/** POST /api/auth/nonce — request a challenge nonce */
router.post('/nonce', authController.getNonce);

/** POST /api/auth/verify — submit signed nonce, receive JWT */
router.post('/verify', authController.verifySignatureAndLogin);

/** POST /api/auth/refresh — refresh a valid JWT */
router.post('/refresh', authController.refreshToken);

/** POST /api/auth/logout */
router.post('/logout', authController.logout);

/** POST /api/auth/revoke-all — emergency revoke all user tokens */
router.post('/revoke-all', authMiddleware, authController.revokeAll);

/** Session management */
router.get('/sessions', authMiddleware, authController.listSessions);
router.delete('/sessions/:id', authMiddleware, authController.revokeSession);
router.delete('/sessions', authMiddleware, authController.revokeAllSessions);

export default router;
