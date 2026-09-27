/** @jest-environment jsdom */

import { renderHook, act } from '@testing-library/react';
import { useOptimisticAction } from '../../hooks/useOptimisticAction';

describe('useOptimisticAction', () => {
  it('returns the actual value with no override applied', () => {
    const { result } = renderHook(() => useOptimisticAction('Active'));
    expect(result.current.value).toBe('Active');
    expect(result.current.isPending).toBe(false);
  });

  it('apply() immediately overrides the displayed value', () => {
    const { result } = renderHook(() => useOptimisticAction('Active'));

    act(() => {
      result.current.apply('Disputed');
    });

    expect(result.current.value).toBe('Disputed');
    expect(result.current.isPending).toBe(true);
  });

  it('revert() drops the override and falls back to the actual value', () => {
    const { result } = renderHook(() => useOptimisticAction('Active'));

    act(() => {
      result.current.apply('Disputed');
    });
    expect(result.current.value).toBe('Disputed');

    act(() => {
      result.current.revert();
    });

    expect(result.current.value).toBe('Active');
    expect(result.current.isPending).toBe(false);
  });

  it('drops the override once the actual value catches up to it', () => {
    const { result, rerender } = renderHook(
      ({ actual }) => useOptimisticAction(actual),
      { initialProps: { actual: 'Active' } },
    );

    act(() => {
      result.current.apply('Disputed');
    });
    expect(result.current.value).toBe('Disputed');
    expect(result.current.isPending).toBe(true);

    // The real data now confirms the same value the override guessed.
    rerender({ actual: 'Disputed' });

    expect(result.current.value).toBe('Disputed');
    expect(result.current.isPending).toBe(false);
  });

  it('keeps a later authoritative change visible after the override clears', () => {
    const { result, rerender } = renderHook(
      ({ actual }) => useOptimisticAction(actual),
      { initialProps: { actual: 'Active' } },
    );

    act(() => {
      result.current.apply('Disputed');
    });
    rerender({ actual: 'Disputed' }); // override clears here
    rerender({ actual: 'Resolved' }); // a later, independent authoritative change

    expect(result.current.value).toBe('Resolved');
    expect(result.current.isPending).toBe(false);
  });
});
