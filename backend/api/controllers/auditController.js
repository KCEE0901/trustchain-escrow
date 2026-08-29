/**
 * Audit Log Controller
 *
 * Handles HTTP requests for retrieving, searching, exporting,
 * verifying, and summarizing system audit logs.
 *
 * @module controllers/auditController
 */

import auditService from '../../services/auditService.js';
import auditVerifier from '../../services/auditVerifier.js';
import { getLogger, logControllerError } from '../../config/logger.js';

/**
 * Express request object with query parameters.
 * @typedef {import('express').Request} Request
 */

/**
 * Express response object for sending JSON or CSV results.
 * @typedef {import('express').Response} Response
 */

/**
 * Searches audit log entries using optional filters and pagination.
 *
 * @async
 * @function searchAuditLogs
 * @param {Request} req - Express request containing search query parameters (`category`, `action`, `actor`, `resourceId`, `from`, `to`, `page`, `limit`).
 * @param {Response} res - Express response object used to deliver JSON list of audit log items.
 * @returns {Promise<void>} Resolves when response has been sent to client.
 * @throws {Error} Logs and returns 500 status code on service failure.
 */
const searchAuditLogs = async (req, res) => {
  try {
    const result = await auditService.search(req.query);
    res.json(result);
  } catch (err) {
    logControllerError('audit.searchAuditLogs', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Exports audit log entries as a downloadable CSV file.
 *
 * @async
 * @function exportAuditLogs
 * @param {Request} req - Express request containing query filters (`category`, `action`, `actor`, `resourceId`, `from`, `to`).
 * @param {Response} res - Express response object configured for CSV attachment download.
 * @returns {Promise<void>} Resolves when CSV payload stream completes.
 * @throws {Error} Logs and returns 500 status code on service failure.
 */
const exportAuditLogs = async (req, res) => {
  try {
    const csv = await auditService.exportCsv(req.query);
    const filename = `audit-export-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logControllerError('audit.exportAuditLogs', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Retrieves aggregate statistical metrics for audit event distribution.
 *
 * @async
 * @function getAuditStats
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response delivering metric breakdowns by action and category.
 * @returns {Promise<void>} Resolves when statistics JSON response is transmitted.
 * @throws {Error} Logs and returns 500 status code on service failure.
 */
const getAuditStats = async (req, res) => {
  try {
    const stats = await auditService.getStats();
    res.json(stats);
  } catch (err) {
    logControllerError('audit.getAuditStats', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Verifies cryptographic signature and hash chain integrity for an audit log entry.
 *
 * @async
 * @function verifyAuditLogIntegrity
 * @param {Request} req - Express request containing target `logId` in route parameters (`req.params.logId`).
 * @param {Response} res - Express response delivering verification result object.
 * @returns {Promise<void>} Resolves when verification outcome is returned.
 * @throws {Error} Logs and returns 500 status code on service failure.
 */
const verifyAuditLogIntegrity = async (req, res) => {
  try {
    const { logId } = req.params;
    const verification = await auditVerifier.verifyLogEntry(logId);
    res.json(verification);
  } catch (err) {
    logControllerError('audit.verifyAuditLogIntegrity', err, req);
    res.status(500).json({ error: err.message });
  }
};

export default {
  searchAuditLogs,
  exportAuditLogs,
  getAuditStats,
  verifyAuditLogIntegrity,
};
