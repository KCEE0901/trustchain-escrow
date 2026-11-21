/**
 * Stellar Service
 *
 * Thin wrapper around the Stellar SDK for server-side operations.
 * Used by the indexer and the broadcast endpoint.
 *
 * @module stellarService
 */

import { SorobanRpc, Transaction, Networks } from '@stellar/stellar-sdk';
import { withSpan } from '../lib/tracing.js';

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.STELLAR_NETWORK || 'testnet';

export const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

/** @returns {SorobanRpc.Server} */
const getServer = () =>
  new SorobanRpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });

/**
 * Runs an async Stellar call and rethrows failures with operation context.
 * Only the operation name, network and the underlying reason are included —
 * never the RPC URL (may embed API keys) or transaction XDR.
 *
 * @param {string} operation — human-readable description of the call
 * @param {() => Promise<any>} fn
 */
const withContext = async (operation, fn) => {
  try {
    return await fn();
  } catch (err) {
    const reason = err?.message || String(err);
    throw new Error(`Stellar ${operation} failed on ${NETWORK}: ${reason}`, { cause: err });
  }
};

/**
 * Submits a signed transaction XDR to the Stellar network and polls until settled.
 *
 * @param {string} signedXdr — base64-encoded signed Stellar transaction
 * @returns {Promise<{ hash: string, status: string, errorResultXdr?: string }>}
 */
const submitTransaction = async (signedXdr) => {
  return withSpan(
    'stellarService.submitTransaction',
    { 'stellar.network': NETWORK },
    async (span) => {
      const server = getServer();
      const tx = await withContext(
        'transaction XDR parsing',
        async () => new Transaction(signedXdr, NETWORK_PASSPHRASE),
      );
      const sendResult = await withContext('sendTransaction', () => server.sendTransaction(tx));

      span.setAttribute('stellar.tx.hash', sendResult.hash);

      if (sendResult.status === 'ERROR') {
        span.setAttribute('stellar.tx.status', 'FAILED');
        return {
          hash: sendResult.hash,
          status: 'FAILED',
          errorResultXdr: sendResult.errorResultXdr,
        };
      }

      const hash = sendResult.hash;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const result = await withContext(`getTransaction (hash ${hash})`, () =>
          server.getTransaction(hash),
        );
        if (result.status !== 'NOT_FOUND') {
          const status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
          span.setAttribute('stellar.tx.status', status);
          span.setAttribute('stellar.tx.poll_attempts', i + 1);
          return { hash, status, errorResultXdr: result.resultXdr };
        }
      }

      span.setAttribute('stellar.tx.status', 'TIMEOUT');
      return { hash, status: 'TIMEOUT' };
    },
  );
};

/**
 * Fetches contract events from Stellar since a given ledger.
 *
 * @param {number} startLedger — start scanning from this ledger sequence
 * @param {string} contractId  — the escrow contract address
 * @returns {Promise<Array>} array of raw Soroban event objects
 */
const getContractEvents = async (startLedger, contractId) => {
  return withSpan(
    'stellarService.getContractEvents',
    {
      'stellar.start_ledger': startLedger,
      'stellar.contract_id': contractId,
    },
    async (span) => {
      const server = getServer();
      const response = await withContext(
        `getEvents (contract ${contractId}, startLedger ${startLedger})`,
        () =>
          server.getEvents({
            startLedger,
            filters: [{ type: 'contract', contractIds: [contractId] }],
          }),
      );
      const events = response.events ?? [];
      span.setAttribute('stellar.events.count', events.length);
      return events;
    },
  );
};

/**
 * Gets the current ledger sequence number.
 *
 * @returns {Promise<number>}
 */
const getLatestLedger = async () => {
  return withSpan('stellarService.getLatestLedger', {}, async (span) => {
    const server = getServer();
    const health = await withContext('getLatestLedger', () => server.getLatestLedger());
    span.setAttribute('stellar.latest_ledger', health.sequence);
    return health.sequence;
  });
};

export { submitTransaction, getContractEvents, getLatestLedger };
