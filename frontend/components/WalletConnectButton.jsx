'use client';

import React from 'react';

/**
 * WalletConnectButton Component
 *
 * Primary trigger button for opening the wallet connection modal or viewing wallet status.
 * Safely handles edge cases: empty/undefined props, malformed input data, and error boundaries.
 *
 * @param {object}   props
 * @param {boolean}  [props.isConnected=false]
 * @param {boolean}  [props.isConnecting=false]
 * @param {string}   [props.address='']
 * @param {string}   [props.network='']
 * @param {Function} [props.onClick]
 * @param {Function} [props.onError]
 * @param {boolean}  [props.disabled=false]
 * @param {string}   [props.customLabel]
 */
export default function WalletConnectButton({
  isConnected = false,
  isConnecting = false,
  address = '',
  network = '',
  onClick,
  onError,
  disabled = false,
  customLabel,
}) {
  const handleClick = (e) => {
    if (disabled || isConnecting) return;
    try {
      if (typeof onClick === 'function') {
        onClick(e);
      }
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err);
      }
    }
  };

  const safeAddress = typeof address === 'string' ? address.trim() : '';
  const formattedAddress =
    safeAddress.length > 10
      ? `${safeAddress.slice(0, 4)}...${safeAddress.slice(-4)}`
      : safeAddress;

  if (isConnecting) {
    return (
      <button
        type="button"
        disabled
        aria-label="Connecting to wallet"
        className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg cursor-not-allowed opacity-75 flex items-center gap-2 text-sm font-medium"
      >
        <span
          className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
        {customLabel || 'Connecting...'}
      </button>
    );
  }

  if (isConnected && formattedAddress) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={`Wallet connected: ${formattedAddress}`}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {customLabel || formattedAddress}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label="Connect Wallet"
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {customLabel || 'Connect Wallet'}
    </button>
  );
}
