import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WindyWebcam } from '@/app/lib/types';

const fetchTerminatorWebcams = vi.fn();
const captureWebcamSnapshot = vi.fn();
const getProfileSettings = vi.fn();
vi.mock('@/app/lib/terminatorPayload', () => ({ fetchTerminatorWebcams: (...a: unknown[]) => fetchTerminatorWebcams(...a) }));
vi.mock('@/app/lib/webcamSnapshot', () => ({ captureWebcamSnapshot: (...a: unknown[]) => captureWebcamSnapshot(...a) }));
vi.mock('@/app/lib/settings/store', () => ({ getProfileSettings: (...a: unknown[]) => getProfileSettings(...a) }));

import { captureLiveScene, isDurableFrameUrl } from './captureLive';

const cam = (over: Partial<WindyWebcam>): WindyWebcam => ({
  webcamId: 1, title: 'c', viewCount: 0, status: 'active',
  images: { current: { preview: 'https://firebasestorage.googleapis.com/f.jpg' } },
  location: { latitude: 1, longitude: 2 }, categories: [],
  phase: 'sunset', rank: 1,
  ...over,
});

beforeEach(() => {
  fetchTerminatorWebcams.mockReset();
  captureWebcamSnapshot.mockReset();
  getProfileSettings.mockReset();
  getProfileSettings.mockResolvedValue({ namespaces: { shared: { activeVersion: 'v1' } }, revision: 3 });
});

describe('isDurableFrameUrl', () => {
  it('accepts firebase storage URLs and rejects windy CDN URLs', () => {
    expect(isDurableFrameUrl('https://firebasestorage.googleapis.com/f.jpg')).toBe(true);
    expect(isDurableFrameUrl('https://images-webcams.windy.com/x/preview.jpg')).toBe(false);
    expect(isDurableFrameUrl(undefined)).toBe(false);
  });
});

describe('captureLiveScene', () => {
  it('keeps durable frames untouched and splits feeds by phase', async () => {
    fetchTerminatorWebcams.mockResolvedValue([
      cam({ webcamId: 1, phase: 'sunrise' }), cam({ webcamId: 2, phase: 'sunset' }),
    ]);
    const result = await captureLiveScene();
    expect(captureWebcamSnapshot).not.toHaveBeenCalled();
    expect(result.state.sunrise).toHaveLength(1);
    expect(result.state.sunset).toHaveLength(1);
    expect(result.pinned).toBe(0);
  });

  it('pins volatile frames and swaps in the uploaded URL', async () => {
    const volatile = cam({ webcamId: 3, images: { current: { preview: 'https://images-webcams.windy.com/3.jpg' } } });
    fetchTerminatorWebcams.mockResolvedValue([volatile]);
    captureWebcamSnapshot.mockResolvedValue({ url: 'https://firebasestorage.googleapis.com/pinned.jpg', path: 'p' });
    const result = await captureLiveScene();
    expect(result.pinned).toBe(1);
    expect(result.state.sunset[0].images?.current.preview)
      .toBe('https://firebasestorage.googleapis.com/pinned.jpg');
  });

  it('counts a failed pin and keeps the original URL', async () => {
    const volatile = cam({ webcamId: 3, images: { current: { preview: 'https://images-webcams.windy.com/3.jpg' } } });
    fetchTerminatorWebcams.mockResolvedValue([volatile]);
    captureWebcamSnapshot.mockResolvedValue(null);
    const result = await captureLiveScene();
    expect(result.pinFailures).toBe(1);
    expect(result.state.sunset[0].images?.current.preview)
      .toBe('https://images-webcams.windy.com/3.jpg');
  });

  it('records provenance from the live profile', async () => {
    fetchTerminatorWebcams.mockResolvedValue([cam({})]);
    const result = await captureLiveScene();
    expect(getProfileSettings).toHaveBeenCalledWith('live');
    expect(result.provenance.activeVersion).toBe('v1');
    expect(result.provenance.settings.shared).toEqual({ activeVersion: 'v1' });
  });

  it('falls back to DEFAULT_MOSAIC_VERSION when live profile has no activeVersion', async () => {
    fetchTerminatorWebcams.mockResolvedValue([cam({})]);
    getProfileSettings.mockResolvedValue({ namespaces: {}, revision: 1 });
    const result = await captureLiveScene();
    expect(result.provenance.activeVersion).toBe('v1');
  });

  it('preserves sibling image fields when pinning volatile frames', async () => {
    const volatile = cam({
      webcamId: 9,
      images: {
        sizes: {
          icon: { width: 48, height: 48 },
          preview: { width: 400, height: 224 },
          thumbnail: { width: 200, height: 112 },
        },
        current: {
          preview: 'https://images-webcams.windy.com/9.jpg',
          icon: 'i.jpg',
          thumbnail: 't.jpg',
        },
        daylight: {
          icon: 'di.jpg',
          preview: 'dp.jpg',
          thumbnail: 'dt.jpg',
        },
      },
    });
    fetchTerminatorWebcams.mockResolvedValue([volatile]);
    captureWebcamSnapshot.mockResolvedValue({ url: 'https://firebasestorage.googleapis.com/pinned-9.jpg', path: 'p' });
    const result = await captureLiveScene();
    expect(result.pinned).toBe(1);
    expect(result.state.sunset[0].images?.current.preview)
      .toBe('https://firebasestorage.googleapis.com/pinned-9.jpg');
    expect(result.state.sunset[0].images?.current.icon).toBe('i.jpg');
    expect(result.state.sunset[0].images?.current.thumbnail).toBe('t.jpg');
    expect(result.state.sunset[0].images?.sizes).toEqual({
      icon: { width: 48, height: 48 },
      preview: { width: 400, height: 224 },
      thumbnail: { width: 200, height: 112 },
    });
    expect(result.state.sunset[0].images?.daylight).toEqual({
      icon: 'di.jpg',
      preview: 'dp.jpg',
      thumbnail: 'dt.jpg',
    });
  });
});
