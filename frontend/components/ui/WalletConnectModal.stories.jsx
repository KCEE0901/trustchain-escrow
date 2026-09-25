import WalletConnectModal from './WalletConnectModal';

/**
 * The `WalletConnectModal` component lets users select and connect a Stellar wallet
 * (such as Freighter) to authenticate and sign transactions on Trustchain Escrow.
 *
 * It supports disconnected, connecting, error, and connected states with accessible
 * dialog attributes and loading feedback.
 */
export default {
  title: 'UI/WalletConnectModal',
  component: WalletConnectModal,
  tags: ['autodocs'],
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'Controls whether the modal is visible',
    },
    onClose: { action: 'closed' },
    onConnected: { action: 'connected' },
  },
  decorators: [
    (Story) => (
      <div className="min-h-[420px] bg-gray-900 flex items-center justify-center p-4">
        <Story />
      </div>
    ),
  ],
};

const baseWallet = {
  address: null,
  network: 'testnet',
  isConnected: false,
  isFreighterInstalled: true,
  isConnecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  signTx: async () => '',
};

// ── Stories (CSF3) ────────────────────────────────────────────────────────────

/**
 * Default state: modal is open and user is prompted to pick a wallet to connect.
 */
export const Default = {
  args: {
    isOpen: true,
    wallet: {
      ...baseWallet,
    },
  },
};

/**
 * Connecting state: Freighter extension connection is pending and showing a loading spinner.
 */
export const Connecting = {
  args: {
    isOpen: true,
    wallet: {
      ...baseWallet,
      isConnecting: true,
    },
  },
};

/**
 * ConnectionError state: shows an accessible error alert when wallet connection fails or is rejected.
 */
export const ConnectionError = {
  args: {
    isOpen: true,
    wallet: {
      ...baseWallet,
      error: 'User declined wallet connection in Freighter extension.',
    },
  },
};

/**
 * Connected state: user already has a wallet connected and its address is displayed.
 */
export const Connected = {
  args: {
    isOpen: true,
    wallet: {
      ...baseWallet,
      isConnected: true,
      address: 'GBBD62Y4YVOWK57JGHV4BCHM7EP3YGYRN3VHC5TBYH3J66Q2E72X5R3S',
    },
  },
};
