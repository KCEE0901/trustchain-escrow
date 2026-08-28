import React, { useState, useCallback } from 'react';
import { isNil, truncateAddress } from '../utils/escrowHelpers';

/**
 * Wallet connection button with consistent null/undefined handling (#278).
 * All checks use the `isNil()` helper — no mixing of `== null`,
 * `=== undefined`, and truthy checks.
 */
export default function WalletConnectButton({
  walletAddress,
  onConnect,
  onDisconnect,
  isConnecting = false,
  disabled = false,
  className = '',
}) {
  const [error, setError] = useState(null);

  const handleConnect = useCallback(async () => {
    if (isNil(onConnect)) return;
    setError(null);
    try {
      await onConnect();
    } catch (err) {
      const message = isNil(err) ? 'Connection failed' :
        isNil(err.message) ? String(err) : err.message;
      setError(message);
    }
  }, [onConnect]);

  const handleDisconnect = useCallback(async () => {
    if (isNil(onDisconnect)) return;
    setError(null);
    try {
      await onDisconnect();
    } catch (err) {
      const message = isNil(err) ? 'Disconnect failed' :
        isNil(err.message) ? String(err) : err.message;
      setError(message);
    }
  }, [onDisconnect]);

  const isConnected = !isNil(walletAddress) && walletAddress.length > 0;

  return (
    <div className={`wallet-connect ${className}`}>
      {isConnected ? (
        <button
          onClick={handleDisconnect}
          disabled={disabled || isConnecting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium transition-colors"
          aria-label={`Disconnect wallet ${truncateAddress(walletAddress)}`}
          data-testid="wallet-disconnect-btn"
        >
          <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true" />
          <span>{truncateAddress(walletAddress)}</span>
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={disabled || isConnecting}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          aria-label="Connect wallet"
          data-testid="wallet-connect-btn"
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {!isNil(error) && (
        <p className="text-red-500 text-xs mt-1" role="alert" data-testid="wallet-error">
          {error}
        </p>
      )}
    </div>
  );
}
