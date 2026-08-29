'use client';

/**
 * WalletConnectButton Component & Utilities
 *
 * Provides a UI button for triggering Stellar/Freighter wallet connection,
 * rendering connection status states (Connecting, Connected, Disconnected),
 * and exporting helper utility functions with full JSDoc annotations.
 *
 * @module components/WalletConnectButton
 */

import React from 'react';

/**
 * Formats a Stellar public wallet address to truncated format (e.g., GABC...XYZ).
 *
 * @param {string} address - Full Stellar wallet address string (56 characters starting with G).
 * @param {number} [startChars=4] - Number of characters to preserve at the start.
 * @param {number} [endChars=4] - Number of characters to preserve at the end.
 * @returns {string} Truncated address string or empty string if input is invalid.
 */
export function formatWalletAddress(address, startChars = 4, endChars = 4) {
  if (!address || typeof address !== 'string') return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Determines button label text based on current wallet connection status flags.
 *
 * @param {boolean} isConnected - True if wallet is connected.
 * @param {boolean} isConnecting - True if wallet connection is in progress.
 * @param {string|null} address - Current active wallet address.
 * @returns {string} Human-readable label string for button display.
 */
export function getConnectButtonLabel(isConnected, isConnecting, address) {
  if (isConnecting) return 'Connecting...';
  if (isConnected && address) return formatWalletAddress(address);
  return 'Connect Wallet';
}

/**
 * Handles wallet click event and dispatches connect or disconnect action.
 *
 * @param {React.MouseEvent<HTMLButtonElement>} event - Mouse click event object.
 * @param {boolean} isConnected - Current wallet connection state.
 * @param {() => void} [onConnect] - Callback triggered when disconnected wallet is clicked.
 * @param {() => void} [onDisconnect] - Callback triggered when connected wallet is clicked.
 * @returns {void}
 */
export function handleWalletClick(event, isConnected, onConnect, onDisconnect) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  if (isConnected && typeof onDisconnect === 'function') {
    onDisconnect();
  } else if (!isConnected && typeof onConnect === 'function') {
    onConnect();
  }
}

/**
 * Renders a stylized action button for connecting or disconnecting Stellar wallets.
 *
 * @component
 * @param {Object} props - React component props.
 * @param {boolean} [props.isConnected=false] - Connection status of the wallet.
 * @param {boolean} [props.isConnecting=false] - Whether connection handshake is in progress.
 * @param {string} [props.address=''] - Truncatable active wallet address string.
 * @param {() => void} [props.onConnect] - Event handler fired on connect action.
 * @param {() => void} [props.onDisconnect] - Event handler fired on disconnect action.
 * @param {string} [props.className=''] - Additional CSS Tailwind classes for styling customization.
 * @param {boolean} [props.disabled=false] - Whether the button should be rendered in disabled state.
 * @returns {JSX.Element} Rendered button component.
 */
export default function WalletConnectButton({
  isConnected = false,
  isConnecting = false,
  address = '',
  onConnect,
  onDisconnect,
  className = '',
  disabled = false,
}) {
  const label = getConnectButtonLabel(isConnected, isConnecting, address);
  const isDisabled = disabled || isConnecting;

  const handleClick = (e) => {
    handleWalletClick(e, isConnected, onConnect, onDisconnect);
  };

  return (
    <button
      type="button"
      id="wallet-connect-action-btn"
      onClick={handleClick}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
        isConnected
          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
      } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      aria-label={
        isConnected ? `Disconnect wallet ${formatWalletAddress(address)}` : 'Connect wallet'
      }
    >
      {isConnecting && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
