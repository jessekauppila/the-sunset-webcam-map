// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { WindyWebcam } from '@/app/lib/types';
import { useLoadedTiles } from './useLoadedTiles';

// Hosts that (like storage.googleapis.com in production) return the image but
// send no Access-Control-Allow-Origin header: a crossOrigin='anonymous' load
// fails, a plain load succeeds.
const NO_CORS_HOST = 'https://storage.googleapis.com';
// URLs that fail no matter what (dead frame).
const DEAD = 'https://dead.example.com/gone.jpg';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = null;
  naturalWidth = 640;
  naturalHeight = 360;
  set src(url: string) {
    queueMicrotask(() => {
      if (url === DEAD) {
        this.onerror?.();
      } else if (url.startsWith(NO_CORS_HOST) && this.crossOrigin) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    });
  }
}

const cam = (id: number, preview: string): WindyWebcam => ({
  webcamId: id,
  title: `cam ${id}`,
  viewCount: 0,
  status: 'active',
  images: { current: { preview } },
  location: { latitude: 47 + id, longitude: -122 },
  categories: [],
  phase: 'sunset',
  rank: id,
});

describe('useLoadedTiles CORS fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads frames from hosts without CORS headers by retrying without crossOrigin', async () => {
    const webcams = [
      cam(1, 'https://images-webcams.windy.com/1.jpg'),
      cam(2, `${NO_CORS_HOST}/bucket/snapshots/2.jpg`),
    ];
    const { result } = renderHook(() => useLoadedTiles(webcams));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(result.current.skipped).toBe(0);
  });

  it('still counts permanently dead frames as skipped', async () => {
    const webcams = [cam(1, 'https://images-webcams.windy.com/1.jpg'), cam(3, DEAD)];
    const { result } = renderHook(() => useLoadedTiles(webcams));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tiles.map((t) => t.id)).toEqual([1]);
    expect(result.current.skipped).toBe(1);
  });
});
