/**
 * Stellar Monitor Routes
 *
 * Endpoints for the Stellar transaction monitoring service.
 * All routes require authentication.
 *
 * GET  /api/stellar-monitor/status           — monitoring service status
 * POST /api/stellar-monitor/transactions      — register a tx for monitoring
 * GET  /api/stellar-monitor/transactions      — list monitored transactions
 * GET  /api/stellar-monitor/review            — admin: transactions needing manual review
 */

import express from 'express';
import stellarMonitorController from '../controllers/stellarMonitorController.js';
import authMiddleware from '../middleware/auth.js';
import adminAuth from '../middleware/adminAuth.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * @route  GET /api/stellar-monitor/status
 * @desc   Get monitoring service status and transaction counts
 */
router.get('/status', stellarMonitorController.getStatus);

/**
 * @route  POST /api/stellar-monitor/transactions
 * @desc   Register a transaction for monitoring
 */
router.post('/transactions', stellarMonitorController.trackTransaction);

/**
 * @route  GET /api/stellar-monitor/transactions
 * @desc   List recent monitored transactions with optional status filter
 */
router.get('/transactions', stellarMonitorController.listTransactions);

/**
 * @route  GET /api/stellar-monitor/review
 * @desc   Admin-only: list transactions stuck pending or requiring manual review
 */
router.get('/review', adminAuth, stellarMonitorController.listReviewNeeded);

export default router;
