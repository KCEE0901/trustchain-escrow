'use client';

/**
 * WalletConnectButton.jsx
 *
 * Renders a wallet connection control with four interactive elements:
 *   1. Connect / Disconnect button
 *   2. Loading spinner button (icon-only, shown while connecting)
 *   3. Copy-address icon button
 *   4. External-link icon button (opens account on Stellar explorer)
 *
 * All interactive elements carry descriptive `aria-label` attributes so that
 * assistive technologies can identify them without relying on visible text.
 * The loading button additionally carries `aria-busy="true"`.
 *
 * Styling uses Tailwind CSS utility classes consistent with the rest of the
 * project. No external icon library is required — SVG icons are inline.
 */

import React, { useState, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base URL for the Stellar expert account explorer. */
const STELLAR_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ||
  'https://stellar.expert/explorer/testnet/account';

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

/**
 * Animated spinner SVG used during connection loading state.
 * aria-hidden because the parent button carries the accessible label.
 */
function SpinnerIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Copy-to-clipboard SVG icon.
 * aria-hidden because the parent button carries the accessible label.
 */
function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * External-link SVG icon.
 * aria-hidden because the parent anchor / button carries the accessible label.
 */
function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ─── WalletConnectButton ──────────────────────────────────────────────────────

/**
 * WalletConnectButton
 *
 * @param {object}   props
 * @param {string}   [props.address]         - Connected wallet public address (G…).
 * @param {boolean}  [props.isConnected]     - Whether a wallet is currently connected.
 * @param {boolean}  [props.isLoading]       - Whether a connection attempt is in progress.
 * @param {Function} [props.onConnect]       - Called when the user clicks Connect.
 * @param {Function} [props.onDisconnect]    - Called when the user clicks Disconnect.
 * @param {string}   [props.network]         - Stellar network name for the explorer link.
 */
export function WalletConnectButton({
  address,
  isConnected = false,
  isLoading = false,
  onConnect,
  onDisconnect,
  network = 'testnet',
}) {
  const [copied, setCopied] = useState(false);

  // ── Derived values ─────────────────────────────────────────────────────────

  /** Truncated address for display, e.g. "GABCD…WXYZ". */
  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : '';

  /** Full explorer URL for this account on the specified network. */
  const explorerUrl = address
    ? `https://stellar.expert/explorer/${network}/account/${address}`
    : '#';

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    if (typeof onConnect === 'function') onConnect();
  }, [onConnect]);

  const handleDisconnect = useCallback(() => {
    if (typeof onDisconnect === 'function') onDisconnect();
  }, [onDisconnect]);

  const handleCopyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard API not available; silently ignore.
    }
  }, [address]);

  // ── Render: loading state ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <button
        type="button"
        disabled
        aria-label="Connecting wallet, please wait…"
        aria-busy="true"
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white opacity-75 cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
      >
        <SpinnerIcon />
        <span>Connecting…</span>
      </button>
    );
  }

  // ── Render: connected state ────────────────────────────────────────────────

  if (isConnected && address) {
    return (
      <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {/* Wallet address pill */}
        <span
          className="mr-1 font-mono text-sm text-gray-700 dark:text-gray-200"
          title={address}
        >
          {shortAddress}
        </span>

        {/* ① Copy-address icon button */}
        <button
          type="button"
          onClick={handleCopyAddress}
          aria-label={
            copied
              ? 'Address copied to clipboard'
              : `Copy wallet address ${address} to clipboard`
          }
          title={copied ? 'Copied!' : 'Copy address'}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <CopyIcon />
        </button>

        {/* ② View on explorer icon button (external link) */}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View account ${shortAddress} on Stellar ${network} explorer (opens in new tab)`}
          title="View on Stellar Explorer"
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <ExternalLinkIcon />
        </a>

        {/* ③ Disconnect button */}
        <button
          type="button"
          onClick={handleDisconnect}
          aria-label="Disconnect wallet"
          className="ml-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // ── Render: disconnected state ─────────────────────────────────────────────

  return (
    <button
      type="button"
      onClick={handleConnect}
      aria-label="Connect your Stellar wallet"
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 active:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-600"
    >
      {/* Wallet icon */}
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-4 w-4"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 10h18M3 6h18M3 14h18M3 18h18"
        />
      </svg>
      Connect Wallet
    </button>
  );
}

export default WalletConnectButton;
