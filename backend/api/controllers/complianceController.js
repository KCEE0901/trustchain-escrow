import complianceService from '../../services/complianceService.js';

function getActor(req) {
  return req.user?.address ?? req.headers['x-admin-api-key']?.slice(0, 8) ?? 'admin';
}

const generateReport = async (req, res) => {
  try {
    const report = await complianceService.generateReport(
      req.params.type,
      req.query,
      getActor(req),
    );
    res.json(report);
  } catch (error) {
    const code = error.message.startsWith('Unsupported') ? 400 : 500;
    res.status(code).json({ error: error.message });
  }
};

const exportReport = async (req, res) => {
  try {
    const format = (req.query.format ?? 'json').toLowerCase();
    const exportResult = await complianceService.exportReport(
      req.params.type,
      format,
      req.query,
      getActor(req),
    );
    const filename = `compliance-${req.params.type}-${Date.now()}.${exportResult.extension}`;
    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportResult.body);
  } catch (error) {
    const code = error.message.startsWith('Unsupported') ? 400 : 500;
    res.status(code).json({ error: error.message });
  }
};

const startExportJob = (req, res) => {
  try {
    const format = (req.query.format ?? 'json').toLowerCase();
    const job = complianceService.startExportJob(req.params.type, format, req.query, getActor(req));
    res.status(202).json(job);
  } catch (error) {
    const code = error.message.startsWith('Unsupported') ? 400 : 500;
    res.status(code).json({ error: error.message });
  }
};

const getExportJob = (req, res) => {
  const job = complianceService.getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  return res.json(job);
};

const downloadExportJob = (req, res) => {
  const job = complianceService.getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (!job.ready) return res.status(409).json({ error: `Export job is ${job.status}` });
  const exportResult = complianceService.getExportJobResult(req.params.id);
  const filename = `compliance-${job.type}-${job.id}.${exportResult.extension}`;
  res.setHeader('Content-Type', exportResult.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(exportResult.body);
};

const createSchedule = async (req, res) => {
  try {
    const { type, format, frequency, filters } = req.body;
    if (!type || !format || !frequency) {
      return res.status(400).json({ error: 'type, format, and frequency are required' });
    }

    const schedule = await complianceService.createSchedule({
      type,
      format,
      frequency,
      filters,
      createdBy: getActor(req),
    });
    res.status(201).json(schedule);
  } catch (error) {
    const code = error.message.startsWith('Unsupported') ? 400 : 500;
    res.status(code).json({ error: error.message });
  }
};

const listSchedules = (_req, res) => {
  res.json(complianceService.listSchedules());
};

const runSchedule = async (req, res) => {
  try {
    const schedule = complianceService.getSchedule(req.params.id);
    const run = await complianceService.runScheduledReport(schedule, getActor(req));
    res.json(run);
  } catch (error) {
    const code = error.message === 'Schedule not found' ? 404 : 500;
    res.status(code).json({ error: error.message });
  }
};

const disableSchedule = async (req, res) => {
  try {
    const schedule = await complianceService.disableSchedule(req.params.id, getActor(req));
    res.json(schedule);
  } catch (error) {
    const code = error.message === 'Schedule not found' ? 404 : 500;
    res.status(code).json({ error: error.message });
  }
};

export default {
  generateReport,
  exportReport,
  startExportJob,
  getExportJob,
  downloadExportJob,
  createSchedule,
  listSchedules,
  runSchedule,
  disableSchedule,
};
