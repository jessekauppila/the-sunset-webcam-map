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
