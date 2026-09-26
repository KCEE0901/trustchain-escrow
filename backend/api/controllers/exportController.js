import exportService from '../../services/exportService.js';

const LARGE_EXPORT_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * Export Controller
 * Handles data export/import endpoints for user data portability
 */

/**
 * Export all user data
 * @route GET /api/users/:address/export
 */
const exportUserData = async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address format (Stellar addresses start with G)
    if (!address || !address.startsWith('G')) {
      return res.status(400).json({
        error: 'Invalid Stellar address format',
      });
    }

    if (req.user?.address !== address && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = req.tenant?.id;
    const data = await exportService.exportUserData(address, { tenantId });
    const fileContent = exportService.generateExportFile(data);

    if (req.isAdmin) {
      await exportService.logAdminExport(address, {
        tenantId,
        performedBy: req.adminId ?? req.user?.address ?? 'admin',
      });
    }

    if (Buffer.byteLength(fileContent, 'utf8') > LARGE_EXPORT_LIMIT_BYTES) {
      const queued = await exportService.queueLargeExport(address, {
        tenantId,
        requestedBy: req.user?.address,
      });
      return res.status(202).json({
        status: 'queued',
        message: 'Export is larger than 10MB and will be delivered by email.',
        jobId: queued.jobId,
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      error: 'Failed to export user data',
    });
  }
};

/**
 * Import user data
 * @route POST /api/users/:address/import
 */
const importUserData = async (req, res) => {
  try {
    const { address } = req.params;
    const { data, mode = 'merge' } = req.body;

    // Validate address format
    if (!address || !address.startsWith('G')) {
      return res.status(400).json({
        error: 'Invalid Stellar address format',
      });
    }

    if (req.user?.address !== address) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Validate import data
    if (!data) {
      return res.status(400).json({
        error: 'Missing data to import',
      });
    }

    // Validate the data structure
    const validation = exportService.validateImportData(data);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid data format',
        details: validation.errors,
      });
    }

    // Merge import data
    const results = await exportService.mergeImportData(address, data, mode);

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({
      error: 'Failed to import user data',
    });
  }
};

/**
 * Download export as file
 * @route GET /api/users/:address/export/file
 */
const downloadExportFile = async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address format
    if (!address || !address.startsWith('G')) {
      return res.status(400).json({
        error: 'Invalid Stellar address format',
      });
    }

    if (req.user?.address !== address && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tenantId = req.tenant?.id;
    const data = await exportService.exportUserData(address, { tenantId });
    const fileContent = exportService.generateExportFile(data);

    if (req.isAdmin) {
      await exportService.logAdminExport(address, {
        tenantId,
        performedBy: req.adminId ?? req.user?.address ?? 'admin',
      });
    }

    if (Buffer.byteLength(fileContent, 'utf8') > LARGE_EXPORT_LIMIT_BYTES) {
      const queued = await exportService.queueLargeExport(address, {
        tenantId,
        requestedBy: req.user?.address,
      });
      return res.status(202).json({
        status: 'queued',
        message: 'Export is larger than 10MB and will be delivered by email.',
        jobId: queued.jobId,
      });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stellar-trust-export-${address}.json"`,
    );
    res.send(fileContent);
  } catch (error) {
    console.error('Download export error:', error);
    res.status(500).json({
      error: 'Failed to generate export file',
    });
  }
};

/**
 * Pseudonymize user data
 * @route DELETE /api/users/:address/data
 */
const deleteUserData = async (req, res) => {
  try {
    const { address } = req.params;

    if (!address || !address.startsWith('G')) {
      return res.status(400).json({
        error: 'Invalid Stellar address format',
      });
    }

    const result = await exportService.pseudonymizeUserData(address, {
      tenantId: req.tenant?.id,
      performedBy: req.adminId ?? 'admin',
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('GDPR deletion error:', error);
    res.status(500).json({
      error: 'Failed to pseudonymize user data',
    });
  }
};

/**
 * Create a new background export job
 * @route POST /api/users/:address/export/jobs
 */
const createExportJob = async (req, res) => {
  try {
    const { address } = req.params;
    if (!address || !address.startsWith('G')) {
      return res.status(400).json({ error: 'Invalid Stellar address format' });
    }

    if (req.user?.address !== address && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const job = exportService.createExportJob(address, {
      tenantId: req.tenant?.id,
      requestedBy: req.user?.address ?? (req.isAdmin ? 'admin' : 'unknown'),
      type: 'escrow_export',
    });

    return res.status(202).json({
      status: 'queued',
      message: 'Export job queued',
      jobId: job.id,
      job,
    });
  } catch (error) {
    console.error('Create export job error:', error);
    return res.status(500).json({ error: 'Failed to create export job' });
  }
};

/**
 * Get status of an export job
 * @route GET /api/users/:address/export/jobs/:jobId
 */
const getExportJobStatus = async (req, res) => {
  try {
    const { address, jobId } = req.params;
    const job = await exportService.getExportJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    if (job.address !== address && req.user?.address !== address && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json({ job });
  } catch (error) {
    console.error('Get export job status error:', error);
    return res.status(500).json({ error: 'Failed to retrieve export job' });
  }
};

/**
 * Cancel an export job
 * @route POST /api/users/:address/export/jobs/:jobId/cancel
 * @route DELETE /api/users/:address/export/jobs/:jobId
 */
const cancelExportJob = async (req, res) => {
  try {
    const { address, jobId } = req.params;
    const existingJob = await exportService.getExportJob(jobId);
    if (!existingJob) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    if (existingJob.address !== address && req.user?.address !== address && !req.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cancelledBy = req.isAdmin ? 'admin' : (req.user?.address ?? 'user');
    const job = await exportService.cancelExportJob(jobId, { cancelledBy });

    return res.json({
      success: true,
      message: 'Export job cancelled successfully',
      job,
    });
  } catch (error) {
    console.error('Cancel export job error:', error);
    const code = error.message.includes('not found')
      ? 404
      : error.message.includes('completed')
        ? 409
        : 500;
    return res.status(code).json({ error: error.message });
  }
};

export default {
  exportUserData,
  importUserData,
  downloadExportFile,
  deleteUserData,
  createExportJob,
  getExportJobStatus,
  cancelExportJob,
};
