import kycService from '../../services/kycService.js';
import { logControllerError } from '../../config/logger.js';
import { buildPaginatedResponse, parsePagination } from '../../lib/pagination.js';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/** POST /api/kyc/token — get Sumsub SDK token for the authenticated user. */
const getToken = async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Valid Stellar address required' });
    }
    const result = await kycService.generateSdkToken(address);
    res.json(result);
  } catch (err) {
    logControllerError('kyc.getToken', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/kyc/status/:address — get KYC status for an address. */
const getStatus = async (req, res) => {
  try {
    const { address } = req.params;
    if (!STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Invalid Stellar address' });
    }
    const record = await kycService.getStatus(address);
    if (!record) return res.json({ address, status: 'Pending' });
    res.json(record);
  } catch (err) {
    logControllerError('kyc.getStatus', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** POST /api/kyc/webhook — Sumsub webhook receiver. */
const webhook = async (req, res) => {
  try {
    const signature = req.headers['x-payload-digest'];
    if (!signature || !kycService.verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    await kycService.handleWebhook(req.body);
    res.json({ ok: true });
  } catch (err) {
    logControllerError('kyc.webhook', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/kyc/admin — list all KYC records (admin only). */
const adminList = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;
    const { data, total } = await kycService.listAll({ skip, take: limit, status });
    res.json(buildPaginatedResponse(data, { total, page, limit }));
  } catch (err) {
    logControllerError('kyc.adminList', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/kyc/admin/:address/history — KYC status transition history (admin only). */
const adminHistory = async (req, res) => {
  try {
    const { address } = req.params;
    if (!STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Invalid Stellar address' });
    }
    const history = await kycService.getHistory(address);
    res.json({ address, data: history });
  } catch (err) {
    logControllerError('kyc.adminHistory', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** PATCH /api/kyc/admin/:address/status — manually override KYC status (admin only). */
const adminOverride = async (req, res) => {
  try {
    const { address } = req.params;
    const { status, reason } = req.body || {};
    if (!STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Invalid Stellar address' });
    }
    if (!status || !reason) {
      return res.status(400).json({ error: 'status and reason are required' });
    }
    const actor = req.admin?.adminId ?? req.adminId ?? 'admin';
    const record = await kycService.overrideStatus({
      address,
      status,
      actor: String(actor),
      reason,
    });
    if (!record) return res.status(404).json({ error: 'KYC record not found' });
    res.json(record);
  } catch (err) {
    if (err.message?.startsWith('Invalid KYC status')) {
      return res.status(400).json({ error: err.message });
    }
    logControllerError('kyc.adminOverride', err, req);
    res.status(500).json({ error: err.message });
  }
};

export default { getToken, getStatus, webhook, adminList, adminHistory, adminOverride };
