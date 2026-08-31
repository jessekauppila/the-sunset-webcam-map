import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useStudioSettings } from './useStudioSettings';

// v1's floorPx default is 100 (COMPOSITION_TILE_FLOOR_PX) — see
// app/components/mosaic/v1/config.ts.
const V1_FLOOR_DEFAULT = 100;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

function settingsResponse(
  studioV1: Record<string, unknown> = {},
  liveV1: Record<string, unknown> = {}
) {
  return {
    studio: { namespaces: { v1: studioV1 }, revision: 1 },
    live: { namespaces: { v1: liveV1 }, revision: 0 },
    lastPollAt: null,
  };
}

describe('useStudioSettings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('diffCount is 1 when studio has a deviation and live does not', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => settingsResponse({ floorPx: 140 }, {}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.diffCount).toBe(1);
    expect(result.current.diffByNamespace.v1).toEqual(['floorPx']);
  });

  it('setKnob updates effective() synchronously and PATCHes the full deviation set after the debounce window', async () => {
    const getResponse = settingsResponse({}, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setKnob('v1', 'floorPx', 200);
    });
    // synchronous optimistic update
    expect(result.current.effective('v1').floorPx).toBe(200);

    const patchCallsBefore = fetchMock.mock.calls.filter(
      (c) => c[1]?.method === 'PATCH'
    );
    expect(patchCallsBefore.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const patchCalls = fetchMock.mock.calls.filter(
      (c) => c[1]?.method === 'PATCH'
    );
    expect(patchCalls.length).toBe(1);
    const [url, init] = patchCalls[0];
    expect(url).toBe('/api/kiosk/settings');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ namespace: 'v1', values: { floorPx: 200 } });
  });

  it('setKnob no-ops (no PATCH) when called with the current effective value, but a genuinely different value still PATCHes', async () => {
    // Guards against leva's echo: it re-fires onChange on every
    // deps-driven resync (e.g. after revert()), calling setKnob with the
    // value each control already has. That must not schedule a PATCH.
    const getResponse = settingsResponse({ floorPx: 140 }, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.effective('v1').floorPx).toBe(140);

    act(() => {
      result.current.setKnob('v1', 'floorPx', 140);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const noopPatchCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
    expect(noopPatchCalls.length).toBe(0);

    // A genuinely different value still schedules and sends a real PATCH —
    // the no-op guard must not block real edits.
    act(() => {
      result.current.setKnob('v1', 'floorPx', 200);
    });
    expect(result.current.effective('v1').floorPx).toBe(200);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const patchCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
    expect(patchCalls.length).toBe(1);
    const body = JSON.parse(patchCalls[0][1].body as string);
    expect(body).toEqual({ namespace: 'v1', values: { floorPx: 200 } });
  });

  it('setting a knob back to its default omits that key from the PATCH', async () => {
    const getResponse = settingsResponse({ floorPx: 140 }, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setKnob('v1', 'floorPx', V1_FLOOR_DEFAULT);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const patchCalls = fetchMock.mock.calls.filter(
      (c) => c[1]?.method === 'PATCH'
    );
    expect(patchCalls.length).toBe(1);
    const [, init] = patchCalls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ namespace: 'v1', values: {} });
  });

  it('deploy() posts to the deploy route and zeroes diffCount from the mutated response', async () => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => settingsResponse({ floorPx: 140 }, {}) };
      }
      if (init.method === 'POST' && url === '/api/kiosk/settings/deploy') {
        return {
          ok: true,
          json: async () => ({
            live: { namespaces: { v1: { floorPx: 140 } }, revision: 1 },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.diffCount).toBe(1);

    await act(async () => {
      await result.current.deploy();
    });

    expect(result.current.diffCount).toBe(0);
    expect(result.current.deployedAtMs).not.toBeNull();
    const deployCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/kiosk/settings/deploy'
    );
    expect(deployCalls.length).toBe(1);
    expect(deployCalls[0][1]?.method).toBe('POST');
  });

  it('deploy() flushes a pending debounced PATCH before posting, so an edit inside the debounce window is not lost', async () => {
    const getResponse = settingsResponse({}, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      if (init.method === 'POST' && url === '/api/kiosk/settings/deploy') {
        return {
          ok: true,
          json: async () => ({
            live: { namespaces: { v1: { floorPx: 200 } }, revision: 1 },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setKnob('v1', 'floorPx', 200);
    });

    // Deploy immediately — no timer advance — so the debounce window has
    // not fired yet and the edit is still only in the optimistic overlay.
    await act(async () => {
      await result.current.deploy();
    });

    const patchOrDeployCalls = fetchMock.mock.calls.filter(
      (c) =>
        c[1]?.method === 'PATCH' ||
        (c[1]?.method === 'POST' && c[0] === '/api/kiosk/settings/deploy')
    );
    expect(patchOrDeployCalls.length).toBe(2);
    expect(patchOrDeployCalls[0][1]?.method).toBe('PATCH');
    expect(patchOrDeployCalls[1][0]).toBe('/api/kiosk/settings/deploy');

    const patchBody = JSON.parse(patchOrDeployCalls[0][1].body as string);
    expect(patchBody).toEqual({ namespace: 'v1', values: { floorPx: 200 } });

    expect(result.current.diffCount).toBe(0);
  });

  it('revert() cancels a pending debounced PATCH (never sent) and clears the optimistic overlay', async () => {
    const getResponse = settingsResponse({}, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      if (init.method === 'POST' && url === '/api/kiosk/settings/revert') {
        return {
          ok: true,
          json: async () => ({
            studio: { namespaces: { v1: { floorPx: 140 } }, revision: 5 },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setKnob('v1', 'floorPx', 200);
    });
    expect(result.current.effective('v1').floorPx).toBe(200);

    // Revert immediately — no timer advance — so the debounce timer is
    // still pending when revert cancels it.
    await act(async () => {
      await result.current.revert();
    });

    // Overlay cleared: effective() now reflects the reverted studio from
    // the server, not the discarded local edit.
    expect(result.current.effective('v1').floorPx).toBe(140);

    // Advance well past the debounce window: the cancelled timer must
    // never fire a PATCH.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const patchCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
    expect(patchCalls.length).toBe(0);
    const revertCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/kiosk/settings/revert'
    );
    expect(revertCalls.length).toBe(1);
  });

  it('two synchronous setKnob calls to the same namespace in one batch both survive', async () => {
    const getResponse = settingsResponse({}, {});
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || (!init.method && url === '/api/kiosk/settings')) {
        return { ok: true, json: async () => getResponse };
      }
      if (init.method === 'PATCH') {
        return { ok: true, json: async () => ({ revision: 2 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setKnob('v1', 'floorPx', 200);
      result.current.setKnob('v1', 'padding', 5);
    });

    // Both edits must be reflected — the second call must not have
    // clobbered the first via a stale render-time overlay snapshot.
    expect(result.current.effective('v1').floorPx).toBe(200);
    expect(result.current.effective('v1').padding).toBe(5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    const patchCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
    expect(patchCalls.length).toBe(1);
    const body = JSON.parse(patchCalls[0][1].body as string);
    expect(body).toEqual({ namespace: 'v1', values: { floorPx: 200, padding: 5 } });
  });
});
