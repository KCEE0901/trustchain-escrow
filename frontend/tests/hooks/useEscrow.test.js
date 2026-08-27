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

  it('passes null key to useSWR when id is falsy (skips fetch)', () => {
    renderHook(() => useEscrow(null));

    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Object));
  });

  it('passes null key to useSWR when id is empty string', () => {
    renderHook(() => useEscrow(''));

    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Object));
  });

  it('configures 30-second polling interval', () => {
    renderHook(() => useEscrow(1));

    const [, , options] = useSWR.mock.calls[0];
    expect(options.refreshInterval).toBe(30_000);
  });

  it('pauses polling when page is hidden (refreshWhenHidden: false)', () => {
    renderHook(() => useEscrow(1));

    const [, , options] = useSWR.mock.calls[0];
    expect(options.refreshWhenHidden).toBe(false);
  });

  it('returns escrow data from SWR', () => {
    const MOCK_ESCROW = { id: 1, title: 'Audit', status: 'Active' };
    useSWR.mockReturnValue({
      data: MOCK_ESCROW,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useEscrow(1));

    expect(result.current.escrow).toEqual(MOCK_ESCROW);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.mutate).toBe(mockMutate);
  });

  it('returns loading state when SWR is fetching', () => {
    useSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useEscrow(1));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.escrow).toBeNull();
  });

  it('returns error from SWR when fetch fails', () => {
    const fetchError = new Error('Network error');
    useSWR.mockReturnValue({
      data: undefined,
      error: fetchError,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useEscrow(1));

    expect(result.current.error).toBe(fetchError);
    expect(result.current.escrow).toBeNull();
  });

  // ── Error message clarity (#223) ────────────────────────────────────────────

  it('fetcher throws an error with HTTP status in the message on non-OK response', async () => {
    // Extract the fetcher function passed to useSWR
    renderHook(() => useEscrow(99));
    const [, fetcherFn] = useSWR.mock.calls[0];

    // Mock global fetch to return a 404
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Escrow not found' }),
    });

    await expect(fetcherFn('http://localhost:4000/api/escrows/99')).rejects.toThrow(
      /HTTP 404/,
    );
  });

  it('fetcher error message includes server-provided reason (not just a generic message)', async () => {
    renderHook(() => useEscrow(99));
    const [, fetcherFn] = useSWR.mock.calls[0];

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: 'Access denied' }),
    });

    await expect(fetcherFn('http://localhost:4000/api/escrows/99')).rejects.toThrow(
      /Access denied/,
    );
  });

  it('fetcher error message does NOT contain auth tokens or secrets', async () => {
    renderHook(() => useEscrow(99));
    const [, fetcherFn] = useSWR.mock.calls[0];

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        error: 'Unauthorized',
        // These fields must never appear in the thrown error message
        token: 'super-secret-jwt',
        secret: 'top-secret',
      }),
    });

    let thrownError;
    try {
      await fetcherFn('http://localhost:4000/api/escrows/99');
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.message).not.toContain('super-secret-jwt');
    expect(thrownError.message).not.toContain('top-secret');
  });

  it('fetcher throws with path and status when body is not JSON', async () => {
    renderHook(() => useEscrow(5));
    const [, fetcherFn] = useSWR.mock.calls[0];

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    await expect(fetcherFn('http://localhost:4000/api/escrows/5')).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('fetcher throws descriptive error on network failure', async () => {
    renderHook(() => useEscrow(7));
    const [, fetcherFn] = useSWR.mock.calls[0];

    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetcherFn('http://localhost:4000/api/escrows/7')).rejects.toThrow(
      /Network request failed.*\/api\/escrows\/7/,
    );
  });
});

describe('useUserEscrows', () => {
  it('returns empty escrows array', () => {
    const { result } = renderHook(() => useUserEscrows('GABC123'));
    expect(result.current.escrows).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('useEscrowList', () => {
  it('returns empty list with defaults', () => {
    const { result } = renderHook(() => useEscrowList());
    expect(result.current.escrows).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('accepts page, limit, status options', () => {
    const { result } = renderHook(() => useEscrowList({ page: 2, limit: 10, status: 'Active' }));
    expect(result.current.escrows).toEqual([]);
  });
});
