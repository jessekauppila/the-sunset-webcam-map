import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: vi.fn(),
}));

import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { getRankedCameras } from './rankedCameras';

const mockFetch = vi.mocked(fetchTerminatorWebcams);

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
  beforeEach(() => mockFetch.mockReset());

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
});
