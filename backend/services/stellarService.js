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
 */
const submitTransaction = async (signedXdr) => {
  return withSpan(
    'stellarService.submitTransaction',
    { 'stellar.network': NETWORK },
    async (span) => {
      let server;
      try {
        server = getServer();
      } catch (err) {
        throw new Error(
          `stellarService.submitTransaction: failed to connect to Soroban RPC at ${RPC_URL} (network: ${NETWORK}). ` +
            `Cause: ${err.message}`,
        );
      }

      let tx;
      try {
        tx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
      } catch (err) {
        throw new Error(
          `stellarService.submitTransaction: invalid XDR — could not deserialise transaction ` +
            `for network "${NETWORK}". Cause: ${err.message}`,
        );
      }

      let sendResult;
      try {
        sendResult = await server.sendTransaction(tx);
      } catch (err) {
        throw new Error(
          `stellarService.submitTransaction: RPC sendTransaction call failed ` +
            `(network: ${NETWORK}, rpc: ${RPC_URL}). Cause: ${err.message}`,
        );
      }

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
        let result;
        try {
          result = await server.getTransaction(hash);
        } catch (err) {
          throw new Error(
            `stellarService.submitTransaction: polling getTransaction failed for hash ${hash} ` +
              `on attempt ${i + 1}/30 (network: ${NETWORK}). Cause: ${err.message}`,
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
        error: `Transaction ${hash} was not confirmed after 30 polling attempts (60 s) on network "${NETWORK}".`,
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
 */
const getContractEvents = async (startLedger, contractId) => {
  return withSpan(
    'stellarService.getContractEvents',
    {
      'stellar.start_ledger': startLedger,
      'stellar.contract_id': contractId,
    },
    async (span) => {
      if (startLedger == null || typeof startLedger !== 'number') {
        throw new Error(
          `stellarService.getContractEvents: startLedger must be a number, got ${JSON.stringify(startLedger)}`,
        );
      }
      if (!contractId) {
        throw new Error(
          `stellarService.getContractEvents: contractId is required but received ${JSON.stringify(contractId)}`,
        );
      }

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
            `starting at ledger ${startLedger} (network: ${NETWORK}, rpc: ${RPC_URL}). ` +
            `Cause: ${err.message}`,
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
 */
const getLatestLedger = async () => {
  return withSpan('stellarService.getLatestLedger', {}, async (span) => {
    const server = getServer();
    let health;
    try {
      health = await server.getLatestLedger();
    } catch (err) {
      throw new Error(
        `stellarService.getLatestLedger: failed to retrieve latest ledger from Soroban RPC ` +
          `(network: ${NETWORK}, rpc: ${RPC_URL}). Cause: ${err.message}`,
      );
    }
    span.setAttribute('stellar.latest_ledger', health.sequence);
    return health.sequence;
  });
};

export { submitTransaction, getContractEvents, getLatestLedger };
