import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../../hooks/useAuth';
import { AppStoreProvider, useWalletStore } from '../../store/app-store';
import * as FreighterAPI from '@stellar/freighter-api';

jest.mock('@stellar/freighter-api');
jest.mock('../../lib/api/client');

function wrapper({ children }) {
  return <AppStoreProvider>{children}</AppStoreProvider>;
}

describe('useAuth', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it('returns initial unauthenticated state', () => {
    const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.authAddress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('exposes login and logout functions', () => {
    const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });
    expect(typeof result.current.login).toBe('function');
    expect(typeof result.current.logout).toBe('function');
  });

  describe('token expiry handling', () => {
    it('detects and clears expired token on mount', async () => {
      // Create an expired JWT (exp is in the past)
      const expiredPayload = {
        sub: 'GXXXXXX',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      // Store the expired token in mock store
      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken(expiredToken);
      });

      // Mount useAuth with the expired token
      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      await waitFor(() => {
        // Token should be cleared when detected as expired
        expect(result.current.token).toBeNull();
      });
    });

    it('auto-logout clears auth state on token expiry', async () => {
      const expiredPayload = {
        sub: 'GXXXXXX',
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken(expiredToken);
      });

      localStorage.setItem('ste_auth_address', 'GXXXXXX');

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      await waitFor(() => {
        expect(result.current.authAddress).toBeNull();
        expect(result.current.isAuthenticated).toBe(false);
      });

      // Verify localStorage was also cleared
      expect(localStorage.getItem('ste_auth_address')).toBeNull();
    });

    it('allows logout after token expiry', async () => {
      const expiredPayload = {
        sub: 'GXXXXXX',
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      const expiredToken = `header.${btoa(JSON.stringify(expiredPayload))}.signature`;

      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken(expiredToken);
      });

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      await waitFor(() => {
        expect(result.current.token).toBeNull();
      });

      // Verify logout can still be called without error
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
    });

    it('preserves valid non-expired token', async () => {
      const validPayload = {
        sub: 'GXXXXXX',
        exp: Math.floor(Date.now() / 1000) + 3600, // Valid for 1 hour
      };
      const validToken = `header.${btoa(JSON.stringify(validPayload))}.signature`;

      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken(validToken);
      });

      localStorage.setItem('ste_auth_address', 'GXXXXXX');

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      // Valid token should be preserved
      expect(result.current.token).toBe(validToken);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.authAddress).toBe('GXXXXXX');
    });

    it('handles malformed token gracefully', async () => {
      const malformedToken = 'not.a.valid.token';

      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken(malformedToken);
      });

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      await waitFor(() => {
        // Malformed token should be cleared
        expect(result.current.token).toBeNull();
      });
    });
  });

  describe('login flow', () => {
    it('prevents login when wallet not connected', async () => {
      const { result } = renderHook(() => useAuth(null), { wrapper });

      await act(async () => {
        await result.current.login();
      });

      expect(result.current.error).toMatch(/wallet first/i);
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('handles signature rejection gracefully', async () => {
      FreighterAPI.signMessage.mockRejectedValueOnce(
        new Error('User declined signing')
      );

      global.fetch = jest.fn();
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'challenge-message' }),
      });

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      await act(async () => {
        await result.current.login();
      });

      expect(result.current.error).toMatch(/rejected|cancelled/i);
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('logout flow', () => {
    it('clears token and address on logout', async () => {
      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken('some-token');
      });

      localStorage.setItem('ste_auth_address', 'GXXXXXX');

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.token).toBeNull();
      expect(result.current.authAddress).toBeNull();
      expect(localStorage.getItem('ste_auth_address')).toBeNull();
    });

    it('handles logout API failure gracefully', async () => {
      const { result: storeResult } = renderHook(() => useWalletStore(), {
        wrapper,
      });

      act(() => {
        storeResult.current.setToken('some-token');
      });

      const { result } = renderHook(() => useAuth('GXXXXXX'), { wrapper });

      global.fetch = jest.fn().mockRejectedValueOnce(
        new Error('Network error')
      );

      // Should not throw, even if logout API fails
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.isAuthenticated).toBe(false);
    });
  });
});
