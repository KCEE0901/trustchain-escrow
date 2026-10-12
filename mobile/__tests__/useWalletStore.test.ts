import { useWalletStore } from '../store/useWalletStore';

const VALID = 'GA7YNBW5CBTJZ3ZZOWX3ZNBKD6OE7A7IHUQVWMY62W2ZBG2SGZVOOPVH';

jest.mock('../lib/storage', () => {
  const data = new Map<string, string>();
  return {
    STORAGE_KEYS: { WALLET_ADDRESS: 'wallet_address' },
    storage: {
      set: jest.fn((key: string, value: string) => data.set(key, value)),
      delete: jest.fn((key: string) => data.delete(key)),
      getString: jest.fn((key: string) => data.get(key)),
    },
  };
});

describe('useWalletStore', () => {
  beforeEach(() => {
    useWalletStore.setState({ address: null, isConnected: false });
  });

  it('connects and persists a valid wallet address', () => {
    useWalletStore.getState().setAddress(VALID);

    expect(useWalletStore.getState().address).toBe(VALID);
    expect(useWalletStore.getState().isConnected).toBe(true);
  });

  it('disconnects and clears wallet state', () => {
    useWalletStore.getState().setAddress(VALID);
    useWalletStore.getState().disconnect();

    expect(useWalletStore.getState().address).toBeNull();
    expect(useWalletStore.getState().isConnected).toBe(false);
  });
});
