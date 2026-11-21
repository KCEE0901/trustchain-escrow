/**
 * Wallet-related UI helpers.
 */

export const FREIGHTER_WALLET_ID = 'freighter';

/**
 * Returns true when a wallet option can be selected.
 *
 * @param {{ available?: boolean } | null | undefined} walletOption
 * @param {string | null | undefined} connectingId
 * @returns {boolean}
 */
export function canSelectWalletOption(walletOption, connectingId) {
  return Boolean(walletOption?.available) && !connectingId;
}

