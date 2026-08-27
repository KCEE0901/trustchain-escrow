import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useReputation, getBadgeFromScore } from '../../hooks/useReputation';

jest.mock('swr');

beforeEach(() => {
  useSWR.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── getBadgeFromScore ─────────────────────────────────────────────────────────

describe('getBadgeFromScore', () => {
  it('returns ELITE for score >= 1000', () => {
    expect(getBadgeFromScore(1000)).toBe('ELITE');
    expect(getBadgeFromScore(1500)).toBe('ELITE');
  });

  it('returns EXPERT for score >= 500', () => {
    expect(getBadgeFromScore(500)).toBe('EXPERT');
    expect(getBadgeFromScore(999)).toBe('EXPERT');
  });

  it('returns VERIFIED for score >= 250', () => {
    expect(getBadgeFromScore(250)).toBe('VERIFIED');
    expect(getBadgeFromScore(499)).toBe('VERIFIED');
  });

  it('returns TRUSTED for score >= 100', () => {
    expect(getBadgeFromScore(100)).toBe('TRUSTED');
    expect(getBadgeFromScore(249)).toBe('TRUSTED');
  });

  it('returns NEW for score < 100', () => {
    expect(getBadgeFromScore(0)).toBe('NEW');
    expect(getBadgeFromScore(99)).toBe('NEW');
  });

  // ── Regression: previously non-numeric inputs could produce wrong badges ──
  it('returns NEW for null (regression #221)', () => {
    expect(getBadgeFromScore(null)).toBe('NEW');
  });

  it('returns NEW for undefined (regression #221)', () => {
    expect(getBadgeFromScore(undefined)).toBe('NEW');
  });

  it('returns NEW for NaN (regression #221)', () => {
    expect(getBadgeFromScore(NaN)).toBe('NEW');
  });

  it('returns NEW for Infinity (regression #221)', () => {
    // Infinity is not a valid reputation score
    expect(getBadgeFromScore(Infinity)).toBe('NEW');
  });

  it('returns NEW for a string that looks like a high score (regression #221)', () => {
    // Before the fix a truthy string like '1000' could slip through comparisons
    expect(getBadgeFromScore('1000')).toBe('NEW');
  });
});

// ── useReputation ─────────────────────────────────────────────────────────────

describe('useReputation', () => {
  it('passes null SWR key when address is null (skips fetch)', () => {
    renderHook(() => useReputation(null));
    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Object));
  });

  it('passes null SWR key when address is undefined (skips fetch)', () => {
    renderHook(() => useReputation(undefined));
    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Object));
  });

  it('passes null SWR key when address is empty string (skips fetch)', () => {
    renderHook(() => useReputation(''));
    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Object));
  });

  it('returns default values when address is null', () => {
    const { result } = renderHook(() => useReputation(null));
    expect(result.current.reputation).toBeNull();
    expect(result.current.badge).toBe('NEW');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns isLoading true while SWR is fetching', () => {
    useSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    const { result } = renderHook(() => useReputation('GABC123'));
    expect(result.current.isLoading).toBe(true);
  });

  it('returns reputation data and correct badge when SWR resolves', () => {
    const mockData = { totalScore: 750, completedEscrows: 10 };
    useSWR.mockReturnValue({ data: mockData, error: undefined, isLoading: false });

    const { result } = renderHook(() => useReputation('GABC123'));

    expect(result.current.reputation).toEqual(mockData);
    expect(result.current.badge).toBe('EXPERT');
    expect(result.current.error).toBeNull();
  });

  it('returns ELITE badge for totalScore >= 1000', () => {
    useSWR.mockReturnValue({ data: { totalScore: 1200 }, error: undefined, isLoading: false });
    const { result } = renderHook(() => useReputation('GABC123'));
    expect(result.current.badge).toBe('ELITE');
  });

  it('returns NEW badge when reputation data has no score', () => {
    useSWR.mockReturnValue({ data: {}, error: undefined, isLoading: false });
    const { result } = renderHook(() => useReputation('GABC123'));
    expect(result.current.badge).toBe('NEW');
  });

  it('returns error from SWR when fetch fails', () => {
    const err = new Error('Network failure');
    useSWR.mockReturnValue({ data: undefined, error: err, isLoading: false });

    const { result } = renderHook(() => useReputation('GABC123'));

    expect(result.current.error).toBe(err);
    expect(result.current.reputation).toBeNull();
  });

  it('configures revalidateOnFocus: false (reputation is infrequently updated)', () => {
    renderHook(() => useReputation('GABC123'));
    const [, , options] = useSWR.mock.calls[0];
    expect(options.revalidateOnFocus).toBe(false);
  });

  it('configures keepPreviousData: true to prevent badge flickering', () => {
    renderHook(() => useReputation('GABC123'));
    const [, , options] = useSWR.mock.calls[0];
    expect(options.keepPreviousData).toBe(true);
  });
});
