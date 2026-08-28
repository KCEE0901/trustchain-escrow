import { render, screen, fireEvent } from '@testing-library/react';
import WalletConnectButton from '../../components/WalletConnectButton';

describe('WalletConnectButton Edge Cases', () => {
  it('renders default button label when empty or undefined props are passed', () => {
    render(<WalletConnectButton />);
    const button = screen.getByRole('button', { name: 'Connect Wallet' });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('safely formats address when given malformed or boundary values without crashing', () => {
    const { rerender } = render(
      <WalletConnectButton isConnected={true} address={null} />,
    );
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeInTheDocument();

    rerender(<WalletConnectButton isConnected={true} address={123456789} />);
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeInTheDocument();

    rerender(
      <WalletConnectButton
        isConnected={true}
        address="   GBRPYHIL2CSIUYVJLB4BWKNM2WTCFRMRGPV67D7Z3OSY4OI76VU4JBW7   "
      />,
    );
    expect(
      screen.getByRole('button', { name: /Wallet connected: GBRP...JBW7/ }),
    ).toBeInTheDocument();
  });

  it('prevents click interactions and stays disabled when disabled or isConnecting', () => {
    const onClick = jest.fn();

    const { rerender } = render(
      <WalletConnectButton isConnecting={true} onClick={onClick} />,
    );
    const connectingBtn = screen.getByRole('button', { name: 'Connecting to wallet' });
    expect(connectingBtn).toBeDisabled();
    fireEvent.click(connectingBtn);
    expect(onClick).not.toHaveBeenCalled();

    rerender(<WalletConnectButton disabled={true} onClick={onClick} />);
    const disabledBtn = screen.getByRole('button', { name: 'Connect Wallet' });
    expect(disabledBtn).toBeDisabled();
    fireEvent.click(disabledBtn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('invokes onError callback on unhappy path when onClick handler throws', () => {
    const onError = jest.fn();
    const throwingOnClick = () => {
      throw new Error('Connection failed unexpectedly');
    };

    render(
      <WalletConnectButton onClick={throwingOnClick} onError={onError} />,
    );
    const button = screen.getByRole('button', { name: 'Connect Wallet' });
    fireEvent.click(button);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
