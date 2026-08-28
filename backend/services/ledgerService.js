'use strict';

/**
 * ledgerService.js
 *
 * Interacts with the Stellar ledger via the Horizon REST API and Soroban RPC.
 * All errors are surfaced as LedgerServiceError instances that carry structured
 * context alongside the human-readable message, so that callers and log
 * aggregators can identify exactly what failed and why.
 */

const StellarSdk = require('@stellar/stellar-sdk');

// ─── Custom error class ───────────────────────────────────────────────────────

/**
 * Structured error for ledger service failures.
 *
 * In addition to the human-readable `message` (which names the failed
 * operation and the relevant identifier), the `context` property contains a
 * plain object suitable for structured logging:
 *
 * ```json
 * {
 *   "operation": "fetchLedger",
 *   "identifier": { "sequence": 12345678 },
 *   "originalMessage": "Connection timeout after 30000ms"
 * }
 * ```
 *
 * @extends Error
 */
class LedgerServiceError extends Error {
  /**
   * @param {string}  message          - Human-readable description of the failure.
   * @param {object}  context          - Structured context for log aggregators.
   * @param {string}  context.operation       - Name of the operation that failed.
   * @param {object}  context.identifier      - Key/value pair identifying the subject (e.g. { sequence: 123 }).
   * @param {string}  [context.originalMessage] - The underlying error message from the SDK or network layer.
   */
  constructor(message, context = {}) {
    super(message);
    this.name = 'LedgerServiceError';
    this.context = context;

    // Maintain correct stack trace in V8 environments.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LedgerServiceError);
    }
  }
}

// ─── Horizon client factory ───────────────────────────────────────────────────

/**
 * Returns a configured Horizon server instance.
 * Falls back to testnet if STELLAR_HORIZON_URL is not set.
 *
 * @returns {StellarSdk.Horizon.Server}
 */
function getHorizonServer() {
  const url =
    process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
  return new StellarSdk.Horizon.Server(url);
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Fetches a single ledger record by its sequence number.
 *
 * @param {number} sequence - The ledger sequence number to fetch.
 * @returns {Promise<object>} The Horizon ledger record.
 * @throws {LedgerServiceError} With operation "fetchLedger" and the sequence number.
 */
async function fetchLedger(sequence) {
  try {
    const server = getHorizonServer();
    const ledger = await server.ledgers().ledger(sequence).call();
    return ledger;
  } catch (err) {
    throw new LedgerServiceError(
      `Failed to fetch ledger sequence ${sequence}: ${err.message}`,
      {
        operation: 'fetchLedger',
        identifier: { sequence },
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Fetches a paginated list of transactions for a given ledger sequence.
 *
 * @param {number} sequence   - Ledger sequence number.
 * @param {object} [options]
 * @param {number} [options.limit=20]   - Number of transactions to return.
 * @param {string} [options.order='asc'] - Sort order: 'asc' or 'desc'.
 * @returns {Promise<object[]>} Array of Horizon transaction records.
 * @throws {LedgerServiceError} With operation "fetchLedgerTransactions" and the sequence number.
 */
async function fetchLedgerTransactions(sequence, { limit = 20, order = 'asc' } = {}) {
  try {
    const server = getHorizonServer();
    const result = await server
      .transactions()
      .forLedger(sequence)
      .limit(limit)
      .order(order)
      .call();
    return result.records;
  } catch (err) {
    throw new LedgerServiceError(
      `Failed to fetch transactions for ledger sequence ${sequence}: ${err.message}`,
      {
        operation: 'fetchLedgerTransactions',
        identifier: { sequence },
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Submits a signed Stellar transaction to the network.
 *
 * @param {string} signedXdr - Base64-encoded signed transaction XDR.
 * @returns {Promise<object>} The Horizon submission result.
 * @throws {LedgerServiceError} With operation "submitTransaction" and a truncated hash hint.
 */
async function submitTransaction(signedXdr) {
  // Derive a short hash hint for error messages without full XDR in logs.
  const hashHint = signedXdr ? signedXdr.slice(0, 16) + '…' : '<empty>';

  try {
    const server = getHorizonServer();
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      process.env.STELLAR_NETWORK_PASSPHRASE ||
        StellarSdk.Networks.TESTNET
    );
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (err) {
    // Horizon wraps submission errors in err.response.data for 400-class responses.
    const detail =
      err?.response?.data?.extras?.result_codes
        ? JSON.stringify(err.response.data.extras.result_codes)
        : err.message;

    throw new LedgerServiceError(
      `Failed to submit transaction (XDR prefix: ${hashHint}): ${detail}`,
      {
        operation: 'submitTransaction',
        identifier: { xdrPrefix: hashHint },
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Retrieves account information for a given Stellar address.
 *
 * @param {string} address - The Stellar public key (G… address).
 * @returns {Promise<object>} The Horizon account record.
 * @throws {LedgerServiceError} With operation "getAccountInfo" and the account address.
 */
async function getAccountInfo(address) {
  try {
    const server = getHorizonServer();
    const account = await server.loadAccount(address);
    return account;
  } catch (err) {
    // Horizon returns a 404 when the account is not yet funded/activated.
    if (err?.response?.status === 404) {
      throw new LedgerServiceError(
        `Account ${address} was not found on the network — it may not be funded yet: ${err.message}`,
        {
          operation: 'getAccountInfo',
          identifier: { address },
          originalMessage: err.message,
        }
      );
    }

    throw new LedgerServiceError(
      `Failed to fetch account info for address ${address}: ${err.message}`,
      {
        operation: 'getAccountInfo',
        identifier: { address },
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Fetches a single transaction by its hash.
 *
 * @param {string} hash - The full SHA-256 transaction hash (hex string).
 * @returns {Promise<object>} The Horizon transaction record.
 * @throws {LedgerServiceError} With operation "fetchTransaction" and the hash.
 */
async function fetchTransaction(hash) {
  try {
    const server = getHorizonServer();
    const tx = await server.transactions().transaction(hash).call();
    return tx;
  } catch (err) {
    throw new LedgerServiceError(
      `Failed to fetch transaction ${hash}: ${err.message}`,
      {
        operation: 'fetchTransaction',
        identifier: { hash },
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Fetches the latest closed ledger sequence number from Horizon.
 *
 * Useful as a lightweight connectivity / health check.
 *
 * @returns {Promise<number>} The sequence number of the most recently closed ledger.
 * @throws {LedgerServiceError} With operation "fetchLatestLedgerSequence".
 */
async function fetchLatestLedgerSequence() {
  try {
    const server = getHorizonServer();
    const result = await server.ledgers().order('desc').limit(1).call();
    const latest = result.records[0];
    return latest.sequence;
  } catch (err) {
    throw new LedgerServiceError(
      `Failed to fetch latest ledger sequence: ${err.message}`,
      {
        operation: 'fetchLatestLedgerSequence',
        identifier: {},
        originalMessage: err.message,
      }
    );
  }
}

/**
 * Fetches all payments for a given account address.
 *
 * @param {string} address - Stellar public key.
 * @param {object} [options]
 * @param {number} [options.limit=20]    - Maximum records to return.
 * @param {string} [options.order='desc'] - Sort order: 'asc' or 'desc'.
 * @returns {Promise<object[]>} Array of Horizon payment operation records.
 * @throws {LedgerServiceError} With operation "fetchAccountPayments" and the address.
 */
async function fetchAccountPayments(address, { limit = 20, order = 'desc' } = {}) {
  try {
    const server = getHorizonServer();
    const result = await server
      .payments()
      .forAccount(address)
      .limit(limit)
      .order(order)
      .call();
    return result.records;
  } catch (err) {
    throw new LedgerServiceError(
      `Failed to fetch payments for account ${address}: ${err.message}`,
      {
        operation: 'fetchAccountPayments',
        identifier: { address },
        originalMessage: err.message,
      }
    );
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  LedgerServiceError,
  fetchLedger,
  fetchLedgerTransactions,
  submitTransaction,
  getAccountInfo,
  fetchTransaction,
  fetchLatestLedgerSequence,
  fetchAccountPayments,
};
