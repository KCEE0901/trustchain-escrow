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
 * Submits a signed transaction XDR to the Stellar network and polls until settled.
 *
 * @param {string} signedXdr — base64-encoded signed Stellar transaction
 * @returns {Promise<{ hash: string, status: string, errorResultXdr?: string }>}
 * @throws {Error} with a descriptive message when submission or deserialization fails
 */
const submitTransaction = async (signedXdr) => {
  return withSpan(
    'stellarService.submitTransaction',
    { 'stellar.network': NETWORK },
    async (span) => {
      let tx;
      try {
        tx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
      } catch (err) {
        throw new Error(
          `stellarService.submitTransaction: failed to deserialize signed XDR — ${err.message}`,
        );
      }

      let sendResult;
      try {
        const server = getServer();
        sendResult = await server.sendTransaction(tx);
      } catch (err) {
        throw new Error(
          `stellarService.submitTransaction: RPC request to ${RPC_URL} failed — ${err.message}`,
        );
      }

      span.setAttribute('stellar.tx.hash', sendResult.hash);

      if (sendResult.status === 'ERROR') {
        span.setAttribute('stellar.tx.status', 'FAILED');
        return {
          hash: sendResult.hash,
          status: 'FAILED',
          errorResultXdr: sendResult.errorResultXdr,
          message: `Transaction rejected by the Stellar network (hash: ${sendResult.hash}). ` +
            `Check errorResultXdr for the specific failure code.`,
        };
      }

      const hash = sendResult.hash;
      const server = getServer();
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        let result;
        try {
          result = await server.getTransaction(hash);
        } catch (err) {
          throw new Error(
            `stellarService.submitTransaction: failed to poll transaction status for hash ${hash} ` +
              `(attempt ${i + 1}/30) — ${err.message}`,
          );
        }
        if (result.status !== 'NOT_FOUND') {
          const status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
          span.setAttribute('stellar.tx.status', status);
          span.setAttribute('stellar.tx.poll_attempts', i + 1);
          return { hash, status, errorResultXdr: result.resultXdr };
        }
      }

      span.setAttribute('stellar.tx.status', 'TIMEOUT');
      return {
        hash,
        status: 'TIMEOUT',
        message: `Transaction ${hash} was submitted but did not reach a final state after 30 polling attempts (60 s). ` +
          `It may still be included in a future ledger — check the Stellar network directly using the hash.`,
      };
    },
  );
};

/**
 * Fetches contract events from Stellar since a given ledger.
 *
 * @param {number} startLedger — start scanning from this ledger sequence
 * @param {string} contractId  — the escrow contract address
 * @returns {Promise<Array>} array of raw Soroban event objects
 * @throws {Error} with a descriptive message when the RPC call fails
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
      let response;
      try {
        response = await server.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: [contractId] }],
        });
      } catch (err) {
        throw new Error(
          `stellarService.getContractEvents: failed to fetch events for contract ${contractId} ` +
            `starting at ledger ${startLedger} from ${RPC_URL} — ${err.message}`,
        );
      }
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
 * @throws {Error} with a descriptive message when the RPC call fails
 */
const getLatestLedger = async () => {
  return withSpan('stellarService.getLatestLedger', {}, async (span) => {
    const server = getServer();
    let health;
    try {
      health = await server.getLatestLedger();
    } catch (err) {
      throw new Error(
        `stellarService.getLatestLedger: failed to retrieve latest ledger from ${RPC_URL} — ${err.message}`,
      );
    }
    span.setAttribute('stellar.latest_ledger', health.sequence);
    return health.sequence;
  });
};

export { submitTransaction, getContractEvents, getLatestLedger };
