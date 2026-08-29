/**
 * Payment Controller
 *
 * Handles HTTP requests for Stripe checkout session creation, status queries,
 * wallet payment history, refund operations, webhook event processing,
 * and keyboard navigation action commands.
 *
 * @module controllers/paymentController
 */

import { getLogger, logControllerError } from '../../config/logger.js';
import paymentService from '../../services/paymentService.js';
import kycService from '../../services/kycService.js';
import { getAuthenticatedWalletAddress } from '../middleware/authorization.js';

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * Express request object with body, query, and header properties.
 * @typedef {import('express').Request} Request
 */

/**
 * Express response object for delivering JSON responses.
 * @typedef {import('express').Response} Response
 */

/**
 * Helper to ensure the authenticated user owns the target wallet address.
 *
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @returns {string|null} Authenticated wallet address string or null if unauthenticated.
 */
function requireOwnedWallet(req, res) {
  const walletAddress = getAuthenticatedWalletAddress(req);
  if (!walletAddress) {
    res.status(403).json({ error: 'Authenticated user is not linked to a wallet address.' });
    return null;
  }
  return walletAddress;
}

/**
 * Creates a Stripe fiat checkout session for funding an escrow contract.
 *
 * @async
 * @function createCheckout
 * @param {Request} req - Express request containing `address`, `amountUsd`, and `escrowId` in `req.body`.
 * @param {Response} res - Express response returning checkout session details.
 * @returns {Promise<void>} Resolves when JSON checkout session response is delivered.
 * @throws {Error} Returns 400 for invalid inputs, 403 for unauthorized/unapproved KYC, or 500 on failure.
 */
const createCheckout = async (req, res) => {
  try {
    const { address, amountUsd, escrowId } = req.body;
    const walletAddress = requireOwnedWallet(req, res);
    if (!walletAddress) return;

    if (!address || !STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Valid Stellar address required' });
    }
    if (address !== walletAddress) {
      return res
        .status(403)
        .json({ error: 'Forbidden: cannot create checkout for another wallet.' });
    }
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

/**
 * Retrieves payment status for a specific Stripe checkout session ID.
 *
 * @async
 * @function getStatus
 * @param {Request} req - Express request containing `sessionId` in route parameters (`req.params.sessionId`).
 * @param {Response} res - Express response returning payment record details.
 * @returns {Promise<void>} Resolves when status payload is returned.
 * @throws {Error} Returns 404 if payment not found, 403 if unauthorized, or 500 on failure.
 */
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

/**
 * Lists payment history for a given Stellar wallet address.
 *
 * @async
 * @function listByAddress
 * @param {Request} req - Express request containing `address` in route parameters (`req.params.address`).
 * @param {Response} res - Express response returning array of payment records.
 * @returns {Promise<void>} Resolves when payment list is returned.
 * @throws {Error} Returns 400 for invalid address format, 403 for unauthorized access, or 500 on failure.
 */
const listByAddress = async (req, res) => {
  try {
    const { address } = req.params;
    const walletAddress = requireOwnedWallet(req, res);
    if (!walletAddress) return;

    if (!STELLAR_ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: 'Invalid Stellar address' });
    }
    if (address !== walletAddress) {
      return res
        .status(403)
        .json({ error: 'Forbidden: cannot access another wallet payment history.' });
    }
    const payments = await paymentService.getByAddress(address);
    res.json(payments);
  } catch (err) {
    logControllerError('payment.listByAddress', err, req);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Issues a full refund for an existing payment record.
 *
 * @async
 * @function refund
 * @param {Request} req - Express request containing `paymentId` in route parameters (`req.params.paymentId`).
 * @param {Response} res - Express response returning updated payment record after refund.
 * @returns {Promise<void>} Resolves when refund completes.
 * @throws {Error} Returns 404 if payment not found, 403 if forbidden, 400 for invalid state, or 500 on failure.
 */
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

/**
 * Processes incoming Stripe webhook notifications.
 *
 * @async
 * @function webhook
 * @param {Request} req - Express request containing raw body and `stripe-signature` header.
 * @param {Response} res - Express response indicating webhook processing success.
 * @returns {Promise<void>} Resolves when webhook acknowledgement is sent.
 * @throws {Error} Returns 400 if signature header is missing or verification fails.
 */
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

/**
 * Maps keyboard key commands (Enter, Escape, Tab) to interactive payment controller actions.
 *
 * @function processKeyboardCommand
 * @param {'Enter'|'Escape'|'Tab'} key - Keyboard key code string.
 * @param {Object} actionContext - Context object containing target action and parameters.
 * @param {'submit'|'cancel'|'nextFocus'} actionContext.actionType - Action classification.
 * @param {Object} [actionContext.payload] - Optional payload for keyboard action execution.
 * @returns {{ handled: boolean, actionType: string, result?: any }} Result object indicating handling status.
 */
const processKeyboardCommand = (key, actionContext = {}) => {
  if (!key || typeof key !== 'string') {
    return { handled: false, actionType: 'unknown' };
  }

  const normalizedKey = key.trim();
  switch (normalizedKey) {
    case 'Enter':
      return {
        handled: true,
        actionType: 'submit',
        result: actionContext.payload || null,
      };
    case 'Escape':
      return {
        handled: true,
        actionType: 'cancel',
        result: null,
      };
    case 'Tab':
      return {
        handled: true,
        actionType: 'nextFocus',
        result: { shiftKey: Boolean(actionContext.shiftKey) },
      };
    default:
      return { handled: false, actionType: 'unsupported' };
  }
};

/**
 * Handles keyboard event HTTP endpoint request or interactive key event payload.
 *
 * @async
 * @function handleKeyPress
 * @param {Request} req - Express request containing `key` and `actionContext` in `req.body`.
 * @param {Response} res - Express response returning keyboard handling result.
 * @returns {Promise<void>} Resolves when keyboard action response is sent.
 */
const handleKeyPress = async (req, res) => {
  try {
    const { key, actionContext } = req.body || {};
    if (!key) {
      return res.status(400).json({ error: 'key parameter is required' });
    }
    const outcome = processKeyboardCommand(key, actionContext);
    res.json(outcome);
  } catch (err) {
    logControllerError('payment.handleKeyPress', err, req);
    res.status(500).json({ error: err.message });
  }
};

export default {
  createCheckout,
  getStatus,
  listByAddress,
  refund,
  webhook,
  processKeyboardCommand,
  handleKeyPress,
};
