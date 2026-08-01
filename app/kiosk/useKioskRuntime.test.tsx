import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKioskRuntime } from './useKioskRuntime';

describe('useKioskRuntime', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    // Noon local, outside default quiet hours
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ doze: false }) });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/kiosk/sunset');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('polls state and fires a tick each minute while awake', async () => {
    renderHook(() => useKioskRuntime());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/api/kiosk/state')).length).toBeGreaterThanOrEqual(2);
    expect(urls.filter((u) => u.includes('/api/kiosk/tick')).length).toBeGreaterThanOrEqual(1);
  });

  it('the d key toggles sticky local doze and stops ticks', async () => {
    const { result } = renderHook(() => useKioskRuntime());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });
    expect(result.current.dozing).toBe(true);
    // an ordinary interaction must NOT wake a manual doze
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(result.current.dozing).toBe(true);
    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/kiosk/tick'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/kiosk/state'))).toBe(true); // still listens
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });
    expect(result.current.dozing).toBe(false);
  });

  it('remote doze from the state poll dozes the kiosk', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ doze: true }) });
    const { result } = renderHook(() => useKioskRuntime());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.dozing).toBe(true);
  });
});
