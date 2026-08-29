import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WalletConnectButton, {
  formatWalletAddress,
  getConnectButtonLabel,
  handleWalletClick,
} from '../components/WalletConnectButton';

describe('WalletConnectButton Utilities', () => {
  it('formats wallet addresses correctly', () => {
    const full = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(formatWalletAddress(full)).toBe('GAAA...AAAA');
    expect(formatWalletAddress('')).toBe('');
    expect(formatWalletAddress('short')).toBe('short');
  });

  it('determines connect button labels', () => {
    expect(getConnectButtonLabel(false, false, '')).toBe('Connect Wallet');
    expect(getConnectButtonLabel(false, true, '')).toBe('Connecting...');
    expect(
      getConnectButtonLabel(
        true,
        false,
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe('GAAA...AAAA');
  });

  it('handles wallet click handlers', () => {
    const onConnect = jest.fn();
    const onDisconnect = jest.fn();
    const event = { preventDefault: jest.fn() };

    handleWalletClick(event, false, onConnect, onDisconnect);
    expect(onConnect).toHaveBeenCalled();

    handleWalletClick(event, true, onConnect, onDisconnect);
    expect(onDisconnect).toHaveBeenCalled();
  });
});

describe('WalletConnectButton Component', () => {
  it('renders disconnected state', () => {
    render(<WalletConnectButton isConnected={false} />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('renders connected state with truncated address', () => {
    const addr = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    render(<WalletConnectButton isConnected={true} address={addr} />);
    expect(screen.getByText('GAAA...AAAA')).toBeInTheDocument();
  });
});
