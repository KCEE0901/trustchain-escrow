import { getLogger, logControllerError } from '../../config/logger.js';
import paymentService from '../../services/paymentService.js';
import kycService from '../../services/kycService.js';
import { getAuthenticatedWalletAddress } from '../middleware/authorization.js';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function requireOwnedWallet(req, res) {
  const walletAddress = getAuthenticatedWalletAddress(req);
  if (!walletAddress) {
    res.status(403).json({ error: 'Authenticated user is not linked to a wallet address.' });
    return null;
  }

  return walletAddress;
}

/**
 * Shared validation used by every handler that takes a Stellar `address` and
 * must confirm it (a) is well-formed and (b) belongs to the authenticated
 * caller. Centralizing this avoids the format/ownership checks drifting out
 * of sync across handlers.
 *
 * On failure this writes the appropriate 400/403 response itself and
 * returns null; callers should `return` immediately when that happens.
 *
 * @param {object} req - Express request.
 * @param {object} res - Express response.
 * @param {string} address - Stellar address supplied by the caller (params or body).
 * @returns {string|null} The validated wallet address, or null if a response was already sent.
 */
function requireOwnedAddress(req, res, address) {
  const walletAddress = requireOwnedWallet(req, res);
  if (!walletAddress) return null;

  if (!address || !STELLAR_ADDRESS_RE.test(address)) {
    res.status(400).json({ error: 'Valid Stellar address required' });
    return null;
  }
  if (address !== walletAddress) {
    res.status(403).json({ error: 'Forbidden: cannot access another wallet.' });
    return null;
  }

  return walletAddress;
}

/** POST /api/payments/checkout — create a Stripe checkout session. */
const createCheckout = async (req, res) => {
  try {
    const { address, amountUsd, escrowId } = req.body;
    const walletAddress = requireOwnedAddress(req, res, address);
    if (!walletAddress) return;

    if (!amountUsd || typeof amountUsd !== 'number' || amountUsd <= 0) {
      return res.status(400).json({ error: 'amountUsd must be a positive number' });
    }

    // KYC gate — require Approved status for fiat on-ramp
    const kyc = await kycService.getStatus(address);
    if (kyc?.status !== 'Approved') {
      return res.status(403).json({ error: 'KYC verification required before funding via fiat' });
    }

    const result = await paymentService.createCheckoutSession({ address, amountUsd, escrowId });
    res.json(result);
  } catch (err) {
    logControllerError('payment.createCheckout', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/payments/status/:sessionId — get payment status by Stripe session ID. */
const getStatus = async (req, res) => {
  try {
    const walletAddress = requireOwnedWallet(req, res);
    if (!walletAddress) return;

    const payment = await paymentService.getBySessionId(req.params.sessionId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.address !== walletAddress) {
      return res.status(403).json({ error: 'Forbidden: cannot access another wallet payment.' });
    }
    res.json(payment);
  } catch (err) {
    logControllerError('payment.getStatus', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/payments/:address — list payments for a Stellar address. */
const listByAddress = async (req, res) => {
  try {
    const { address } = req.params;
    const walletAddress = requireOwnedAddress(req, res, address);
    if (!walletAddress) return;

    const payments = await paymentService.getByAddress(address);
    res.json(payments);
  } catch (err) {
    logControllerError('payment.listByAddress', err, req);
    res.status(500).json({ error: err.message });
  }
};

/** POST /api/payments/:paymentId/refund — issue a full refund. */
const refund = async (req, res) => {
  try {
    const walletAddress = requireOwnedWallet(req, res);
    if (!walletAddress) return;

    const existingPayment = await paymentService.getById(req.params.paymentId);
    if (!existingPayment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (existingPayment.address !== walletAddress) {
      return res.status(403).json({ error: 'Forbidden: cannot refund another wallet payment.' });
    }

    const payment = await paymentService.refund(req.params.paymentId);
    res.json(payment);
  } catch (err) {
    const status = err.message.startsWith('Cannot refund') ? 400 : 500;
    if (status >= 500) logControllerError('payment.refund', err, req);
    res.status(status).json({ error: err.message });
  }
};

/** POST /api/payments/webhook — Stripe webhook receiver. */
const webhook = async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });
    await paymentService.handleWebhook(req.rawBody, signature);
    res.json({ ok: true });
  } catch (err) {
    getLogger().warn({
      message: 'payment.webhook_rejected',
      error: err.message,
    });
    res.status(400).json({ error: err.message });
  }
};

export default { createCheckout, getStatus, listByAddress, refund, webhook };
