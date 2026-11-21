import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { useEscrowList } from '../hooks/useEscrows';

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: false })),
}));

jest.mock('../services/offlineCache', () => ({
  getCachedEscrows: jest.fn(() => [
    { id: '1', status: 'Active' },
    { id: '2', status: 'Active' },
    { id: '3', status: 'Completed' },
  ]),
  cacheEscrow: jest.fn(),
  getCachedEscrow: jest.fn(),
  cacheMilestones: jest.fn(),
  getCachedMilestones: jest.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useEscrowList pagination', () => {
  it('pages offline cached escrows and reports end-of-list state', async () => {
    const { result } = renderHook(() => useEscrowList({ status: 'Active', limit: 1, offset: 1 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data).toEqual([{ id: '2', status: 'Active' }]);
    expect(result.current.data?.total).toBe(2);
    expect(result.current.data?.hasNextPage).toBe(false);
    expect(result.current.data?.hasPreviousPage).toBe(true);
  });
});
