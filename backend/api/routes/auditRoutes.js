/**
 * Audit Routes
 *
 * Provides search and export endpoints for the audit log.
 * All routes require admin authentication.
 *
 * Controller functions return structured JSON with RFC 5988 Link headers —
 * see auditController.js for full response-shape documentation.
 *
 * @module routes/auditRoutes
 */

import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import { searchAuditLogs, exportAuditLogs } from '../controllers/auditController.js';

const router = express.Router();
router.use(adminAuth);

/**
 * @route  GET /api/audit
 * @desc   Search audit logs with optional filters and pagination.
 * @query  category, action, actor, resourceId, from (ISO), to (ISO), page, limit
 */
router.get('/', searchAuditLogs);

/**
 * @route  GET /api/audit/export
 * @desc   Export audit logs as a CSV file (max 10 000 rows).
 * @query  category, action, actor, resourceId, from (ISO), to (ISO)
 */
router.get('/export', exportAuditLogs);

export default router;
