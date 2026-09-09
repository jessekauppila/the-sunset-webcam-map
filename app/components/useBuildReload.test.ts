import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { CONFIRM_MS, RELOAD_COOLDOWN_MS, BUILD_ID } from '@/app/lib/buildStamp';
import { useBuildReload, LAST_RELOAD_KEY } from './useBuildReload';

/**
 * BUILD_ID is 'dev' under vitest, and a dev build never compares — which is
 * the point of that rule, and means these tests must stamp the client end
 * themselves. The module reads the constant at import time, so the test
 * replaces it the same way.
 */
vi.mock('@/app/lib/buildStamp', async () => {
  const actual = await vi.importActual<typeof import('@/app/lib/buildStamp')>('@/app/lib/buildStamp');
  return { ...actual, BUILD_ID: 'aaaaaaaaaaaa' };
});

const reload = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  window.localStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBuildReload', () => {
  it('holds still while the tab and the server agree', () => {
    renderHook(() => useBuildReload(BUILD_ID));
    vi.advanceTimersByTime(CONFIRM_MS * 3);
    expect(reload).not.toHaveBeenCalled();
  });

  it('holds still before the poll has answered', () => {
    renderHook(() => useBuildReload(null));
    vi.advanceTimersByTime(CONFIRM_MS * 3);
    expect(reload).not.toHaveBeenCalled();
  });

  // A rollout can hand out one response from each side, so a single
  // disagreement must not black out the glass.
  it('does not reload on a mismatch that has not held long enough', () => {
    renderHook(() => useBuildReload('bbbbbbbbbbbb'));
    vi.advanceTimersByTime(CONFIRM_MS - 1_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once the mismatch has held', () => {
    renderHook(() => useBuildReload('bbbbbbbbbbbb'));
    vi.advanceTimersByTime(CONFIRM_MS + 1_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again inside the cooldown', () => {
    window.localStorage.setItem(LAST_RELOAD_KEY, String(Date.now() - 1_000));
    renderHook(() => useBuildReload('bbbbbbbbbbbb'));
    vi.advanceTimersByTime(CONFIRM_MS + 1_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the cooldown has passed', () => {
    window.localStorage.setItem(LAST_RELOAD_KEY, String(Date.now() - RELOAD_COOLDOWN_MS - 1_000));
    renderHook(() => useBuildReload('bbbbbbbbbbbb'));
    vi.advanceTimersByTime(CONFIRM_MS + 1_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // The reload is remembered before it is asked for, so the tab that comes
  // back knows one already happened even if the mismatch outlives it.
  it('records the reload it performed', () => {
    renderHook(() => useBuildReload('bbbbbbbbbbbb'));
    vi.advanceTimersByTime(CONFIRM_MS + 1_000);
    expect(window.localStorage.getItem(LAST_RELOAD_KEY)).not.toBeNull();
  });
});
