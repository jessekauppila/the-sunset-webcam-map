import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoadedTiles } from './useLoadedTiles';
import type { WindyWebcam } from '@/app/lib/types';

const cam = (id: number, preview: string | null, over: Partial<WindyWebcam> = {}): WindyWebcam =>
  ({
    webcamId: id,
    title: `cam ${id}`,
    viewCount: 0,
    status: 'active',
    location: { city: '', region: '', latitude: 45, longitude: -120, country: '', continent: '' },
    categories: [],
    images: preview ? { current: { preview } } : undefined,
    ...over,
  }) as WindyWebcam;

interface FakeImage {
  crossOrigin?: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
}

let created: FakeImage[] = [];

beforeEach(() => {
  created = [];
  vi.stubGlobal(
    'Image',
    class {
      crossOrigin?: string;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 300;
      #src = '';
      set src(v: string) {
        this.#src = v;
        created.push(this as unknown as FakeImage);
      }
      get src() {
        return this.#src;
      }
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

const opts = { qualitySource: 'auto' as const, gateThreshold: 0.55 };

describe('useLoadedTiles', () => {
  it('counts webcams with no preview as skipped', async () => {
    const cams = [cam(1, null)];
    const { result } = renderHook(() => useLoadedTiles(cams, opts));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skipped).toBe(1);
    expect(result.current.tiles).toEqual([]);
  });

  it('tries CORS first', async () => {
    const cams = [cam(1, 'https://storage.googleapis.com/a.jpg')];
    renderHook(() => useLoadedTiles(cams, opts));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].crossOrigin).toBe('anonymous');
  });

  it('retries WITHOUT crossOrigin when the CORS load fails', async () => {
    // storage.googleapis.com serves no CORS headers — this retry is the only
    // reason production frames render at all.
    const cams = [cam(1, 'https://storage.googleapis.com/a.jpg')];
    renderHook(() => useLoadedTiles(cams, opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onerror?.();
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[1].crossOrigin).toBeUndefined();
  });

  it('produces a tile with natural dimensions and signal fields', async () => {
    const cams = [cam(1, 'https://x/a.jpg', { aiRatingBinary: 4, aiRatingRegression: 5 })];
    const { result } = renderHook(() => useLoadedTiles(cams, opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));
    const tile = result.current.tiles[0];
    expect(tile).toMatchObject({
      id: 1, lat: 45, lng: -120, srcWidth: 400, srcHeight: 300, passes: true, score: 1,
    });
  });

  it('computes solar altitude at the supplied moment, not now', async () => {
    const cams = [cam(1, 'https://x/a.jpg')];
    const optsAt = { ...opts, at: '2026-03-20T12:00:00Z' };
    const { result } = renderHook(() => useLoadedTiles(cams, optsAt));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));
    const alt = result.current.tiles[0].sunAltitudeDeg!;
    // 45N 120W at 2026-03-20T12:00Z is ~04:00 local solar time — roughly
    // -21 deg. Asserted loosely; the point is "not computed for right now".
    expect(alt).toBeLessThan(-15);
  });

  it('counts a frame that fails both attempts as skipped', async () => {
    const cams = [cam(1, 'https://x/a.jpg')];
    const { result } = renderHook(() => useLoadedTiles(cams, opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onerror?.();
    await waitFor(() => expect(created).toHaveLength(2));
    created[1].onerror?.();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skipped).toBe(1);
    expect(result.current.tiles).toEqual([]);
  });

  it('bails out instead of re-rendering when an empty pool is rebuilt', async () => {
    // PreviewPane hands the mosaic a fresh `[]` on every render while a scene
    // is still resolving. Without the bail-out, each new array reference fires
    // the effect, which writes a new state object, which re-renders — forever.
    // Returning `prev` unchanged is what breaks that cycle, so pin it.
    const { result, rerender } = renderHook(
      ({ cams }) => useLoadedTiles(cams, opts),
      { initialProps: { cams: [] as WindyWebcam[] } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const first = result.current;
    rerender({ cams: [] }); // new array, identical content

    expect(result.current).toBe(first);
  });

  it('holds the last good batch on screen while the next one loads', async () => {
    // The pool refetches every 60s and hands us a fresh array. Clearing tiles
    // at the start of the new cycle paints the canvas black until the images
    // resolve, so the wall blinks once a minute. Hold the previous batch.
    const { result, rerender } = renderHook(
      ({ cams }) => useLoadedTiles(cams, opts),
      { initialProps: { cams: [cam(1, 'https://x/a.jpg')] } }
    );
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));

    rerender({ cams: [cam(1, 'https://x/a.jpg')] }); // same camera, new array

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.tiles).toHaveLength(1);
    expect(result.current.byId.get(1)).toBeDefined();
  });

  it('replaces the held batch once the new one settles', async () => {
    const { result, rerender } = renderHook(
      ({ cams }) => useLoadedTiles(cams, opts),
      { initialProps: { cams: [cam(1, 'https://x/a.jpg')] } }
    );
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));

    rerender({ cams: [cam(2, 'https://x/b.jpg')] });
    await waitFor(() => expect(created).toHaveLength(2));
    created[1].onload?.();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tiles.map((t) => t.id)).toEqual([2]);
    expect(result.current.byId.get(1)).toBeUndefined();
  });
});

describe('useLoadedTiles — miss grace', () => {
  // Load both cameras, then hand the hook a pool without camera 1.
  async function loadThenDrop(graceCycles: number) {
    const hook = renderHook(
      ({ cams, at }) => useLoadedTiles(cams, { ...opts, missGraceCycles: graceCycles, at }),
      { initialProps: { cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:00:00Z' } }
    );
    await waitFor(() => expect(created).toHaveLength(2));
    created[0].onload?.();
    created[1].onload?.();
    await waitFor(() => expect(hook.result.current.tiles).toHaveLength(2));
    return hook;
  }

  /** One refetch cycle without camera 1; camera 2 loads. */
  async function cycleWithout1(hook: Awaited<ReturnType<typeof loadThenDrop>>, at: string) {
    const before = created.length;
    hook.rerender({ cams: [cam(2, 'https://x/b.jpg')], at });
    await waitFor(() => expect(created).toHaveLength(before + 1));
    created[before].onload?.();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  }

  it('holds a camera missing from one cycle, with a FRESH solar altitude', async () => {
    const hook = await loadThenDrop(2);
    const altBefore = hook.result.current.tiles.find((t) => t.id === 1)!.sunAltitudeDeg;

    await cycleWithout1(hook, '2026-03-20T18:00:00Z');
    const ids = hook.result.current.tiles.map((t) => t.id).sort();
    expect(ids).toEqual([1, 2]);
    expect(hook.result.current.held).toBe(1);
    expect(hook.result.current.byId.get(1)).toBeDefined();
    const altAfter = hook.result.current.tiles.find((t) => t.id === 1)!.sunAltitudeDeg;
    expect(altAfter).not.toBe(altBefore);
  });

  it('drops the camera once it has missed more than missGraceCycles cycles', async () => {
    const hook = await loadThenDrop(2);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    await cycleWithout1(hook, '2026-03-20T12:02:00Z');
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
    await cycleWithout1(hook, '2026-03-20T12:03:00Z');
    expect(hook.result.current.tiles.map((t) => t.id)).toEqual([2]);
    expect(hook.result.current.held).toBe(0);
    expect(hook.result.current.byId.get(1)).toBeUndefined();
  });

  it('resets the count when the camera comes back', async () => {
    const hook = await loadThenDrop(1);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    // Back for one cycle.
    const before = created.length;
    hook.rerender({ cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:02:00Z' });
    await waitFor(() => expect(created).toHaveLength(before + 2));
    created[before].onload?.();
    created[before + 1].onload?.();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.held).toBe(0);
    // Gone again: held, not dropped — the earlier miss was forgiven.
    await cycleWithout1(hook, '2026-03-20T12:03:00Z');
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it('treats a failed load like a missing camera', async () => {
    const hook = await loadThenDrop(2);
    const before = created.length;
    hook.rerender({ cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:01:00Z' });
    await waitFor(() => expect(created).toHaveLength(before + 2));
    created[before].onerror?.(); // camera 1, CORS attempt
    await waitFor(() => expect(created).toHaveLength(before + 3));
    created[before + 2].onerror?.(); // camera 1, plain attempt
    created[before + 1].onload?.(); // camera 2
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(hook.result.current.held).toBe(1);
    expect(hook.result.current.skipped).toBe(1);
  });

  it('missGraceCycles 0 drops immediately (the v3 behaviour)', async () => {
    const hook = await loadThenDrop(0);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    expect(hook.result.current.tiles.map((t) => t.id)).toEqual([2]);
    expect(hook.result.current.held).toBe(0);
  });
});
