import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useEscrow, useUserEscrows, useEscrowList } from '../../hooks/useEscrow';

jest.mock('swr');

const mockMutate = jest.fn();

beforeEach(() => {
  useSWR.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
    mutate: mockMutate,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('useEscrow', () => {
  it('calls useSWR with the correct URL when id is provided', () => {
    renderHook(() => useEscrow(42));
    expect(useSWR).toHaveBeenCalledWith(
      expect.stringContaining('/api/escrows/42'),
      expect.any(Function),
      expect.any(Object),
    );
  });
});

describe('useUserEscrows', () => {
  it('skips fetch until address is provided', () => {
    renderHook(() => useUserEscrows(null));
    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it('requests user escrows with role filter', () => {
    renderHook(() => useUserEscrows('GCLIENT', 'client'));
    expect(useSWR).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/users\/GCLIENT\/escrows\?role=client/),
      expect.any(Function),
    );
  });

  it('maps API data to escrows array', () => {
    useSWR.mockReturnValue({ data: { data: [{ id: 1 }] }, error: undefined, isLoading: false });
    const { result } = renderHook(() => useUserEscrows('GADDR'));
    expect(result.current.escrows).toEqual([{ id: 1 }]);
  });

  it('exposes API errors', () => {
    const err = new Error('boom');
    useSWR.mockReturnValue({ data: undefined, error: err, isLoading: false });
    const { result } = renderHook(() => useUserEscrows('GADDR'));
    expect(result.current.error).toBe(err);
  });
});

describe('useEscrowList', () => {
  it('passes pagination and status to the list endpoint', () => {
    renderHook(() => useEscrowList({ page: 2, limit: 10, status: 'Active' }));
    const [key] = useSWR.mock.calls[0];
    expect(key).toContain('page=2');
    expect(key).toContain('limit=10');
    expect(key).toContain('status=Active');
  });

  it('returns empty escrows without masking errors', () => {
    useSWR.mockReturnValue({ data: { data: [], pagination: { total: 0 } }, error: undefined, isLoading: false });
    const { result } = renderHook(() => useEscrowList());
    expect(result.current.escrows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});