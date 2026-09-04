import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: vi.fn(),
}));
vi.mock('@/app/lib/cache', () => ({
  getCachedTerminatorPayload: vi.fn(),
  setCachedTerminatorPayload: vi.fn(),
}));

import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import {
  getCachedTerminatorPayload,
  setCachedTerminatorPayload,
} from '@/app/lib/cache';
import { getRankedCameras } from './rankedCameras';

const mockFetch = vi.mocked(fetchTerminatorWebcams);
const mockCacheGet = vi.mocked(getCachedTerminatorPayload);
const mockCacheSet = vi.mocked(setCachedTerminatorPayload);

function webcam(over: Record<string, unknown>) {
  return {
    webcamId: 1,
    title: 'cam',
    rank: 1,
    location: { longitude: 0, latitude: 0, city: '', region: '', country: '', continent: '' },
    images: { current: { preview: 'x.jpg' } },
    ...over,
  } as unknown as Awaited<ReturnType<typeof fetchTerminatorWebcams>>[number];
}

describe('getRankedCameras', () => {
  beforeEach(() => {
    // Braces on purpose: a concise arrow would hand Vitest the mock as a
    // teardown function.
    mockFetch.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
    // Default: cache miss, write succeeds.
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
  });

  it('maps webcams to RingCamera and sorts best (lowest rank) first', async () => {
    mockFetch.mockResolvedValue([
      webcam({ webcamId: 2, rank: 5, location: { longitude: 10, latitude: 0, city: '', region: '', country: '', continent: '' } }),
      webcam({ webcamId: 1, rank: 1, location: { longitude: -20, latitude: 0, city: '', region: '', country: '', continent: '' } }),
    ]);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([1, 2]);
    expect(out[0]).toEqual({ id: 1, lng: -20, title: 'cam', imageUrl: 'x.jpg' });
  });

  it('drops webcams that have no usable image URL', async () => {
    mockFetch.mockResolvedValue([
      webcam({ webcamId: 1, rank: 1, images: undefined }),
      webcam({ webcamId: 2, rank: 2, images: { current: { preview: 'ok.jpg' } } }),
    ]);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([2]);
  });

  it('uses null title when the webcam title is empty', async () => {
    mockFetch.mockResolvedValue([webcam({ title: '' })]);
    const out = await getRankedCameras();
    expect(out[0].title).toBeNull();
  });

  it('serves from the 300s terminator cache and never touches the database on a hit', async () => {
    mockCacheGet.mockResolvedValue([webcam({ webcamId: 7, rank: 1 })]);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([7]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('on a miss reads the database once and repopulates the cache with what it read', async () => {
    const pool = [webcam({ webcamId: 3, rank: 2 })];
    mockFetch.mockResolvedValue(pool);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([3]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCacheSet).toHaveBeenCalledWith(pool);
  });

  it('still answers the heartbeat when the cache write fails', async () => {
    mockFetch.mockResolvedValue([webcam({ webcamId: 4, rank: 1 })]);
    mockCacheSet.mockRejectedValue(new Error('redis down'));
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([4]);
  });
});
