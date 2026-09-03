import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WindyWebcam } from '@/app/lib/types';

const fetchTerminatorWebcams = vi.fn();
const captureWebcamSnapshot = vi.fn();
const getProfileSettings = vi.fn();
const archiveSceneFrame = vi.fn();
vi.mock('@/app/lib/terminatorPayload', () => ({ fetchTerminatorWebcams: (...a: unknown[]) => fetchTerminatorWebcams(...a) }));
vi.mock('@/app/lib/webcamSnapshot', () => ({ captureWebcamSnapshot: (...a: unknown[]) => captureWebcamSnapshot(...a) }));
vi.mock('@/app/lib/settings/store', () => ({ getProfileSettings: (...a: unknown[]) => getProfileSettings(...a) }));
vi.mock('./archive', () => ({ archiveSceneFrame: (...a: unknown[]) => archiveSceneFrame(...a) }));

import { captureLiveScene, isDurableFrameUrl, firebasePathFromUrl } from './captureLive';

const cam = (over: Partial<WindyWebcam>): WindyWebcam => ({
  webcamId: 1, title: 'c', viewCount: 0, status: 'active',
  images: { current: { preview: 'https://storage.googleapis.com/sunset-webcam-map.appspot.com/snapshots/1/1700000000000.jpg' } },
  location: { latitude: 1, longitude: 2 }, categories: [],
  phase: 'sunset', rank: 1,
  ...over,
});

beforeEach(() => {
  fetchTerminatorWebcams.mockReset();
  captureWebcamSnapshot.mockReset();
  getProfileSettings.mockReset();
  archiveSceneFrame.mockReset();
  archiveSceneFrame.mockResolvedValue(1);
  getProfileSettings.mockResolvedValue({ namespaces: { shared: { activeVersion: 'v1' } }, revision: 3 });
});

describe('isDurableFrameUrl', () => {
  it('accepts real storage.googleapis.com upload URLs (see uploadToFirebase)', () => {
    expect(
      isDurableFrameUrl(
        'https://storage.googleapis.com/sunset-webcam-map.appspot.com/snapshots/1/1700000000000.jpg'
      )
    ).toBe(true);
  });

  it('also accepts firebasestorage.googleapis.com as a compatibility bonus', () => {
    expect(isDurableFrameUrl('https://firebasestorage.googleapis.com/f.jpg')).toBe(true);
  });

  it('rejects windy CDN URLs, undefined, and malformed URLs', () => {
    expect(isDurableFrameUrl('https://images-webcams.windy.com/x/preview.jpg')).toBe(false);
    expect(isDurableFrameUrl(undefined)).toBe(false);
    expect(isDurableFrameUrl('not a url')).toBe(false);
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

  it('pins >5 volatile frames in bounded chunks, preserving pool order and accounting for null and rejected pins', async () => {
    const cams = Array.from({ length: 8 }, (_, i) =>
      cam({
        webcamId: i + 1,
        images: { current: { preview: `https://images-webcams.windy.com/${i + 1}.jpg` } },
      })
    );
    fetchTerminatorWebcams.mockResolvedValue(cams);

    captureWebcamSnapshot.mockImplementation((c: WindyWebcam) => {
      if (c.webcamId === 3) return Promise.resolve(null); // null result -> pinFailure
      if (c.webcamId === 6) return Promise.reject(new Error('boom')); // rejection -> pinFailure
      return Promise.resolve({
        url: `https://storage.googleapis.com/bucket/pinned-${c.webcamId}.jpg`,
        path: 'p',
      });
    });

    const result = await captureLiveScene();

    expect(result.pinned).toBe(6);
    expect(result.pinFailures).toBe(2);
    // Original pool order (webcamId 1..8) must be preserved in the output.
    expect(result.state.sunset.map((c) => c.webcamId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Failed pins (null and rejected) keep the original, unmutated cam/URL.
    expect(result.state.sunset[2].images?.current.preview).toBe(
      'https://images-webcams.windy.com/3.jpg'
    );
    expect(result.state.sunset[5].images?.current.preview).toBe(
      'https://images-webcams.windy.com/6.jpg'
    );
    // Successful pins swap in the uploaded URL, including one from the second chunk.
    expect(result.state.sunset[0].images?.current.preview).toBe(
      'https://storage.googleapis.com/bucket/pinned-1.jpg'
    );
    expect(result.state.sunset[7].images?.current.preview).toBe(
      'https://storage.googleapis.com/bucket/pinned-8.jpg'
    );
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

describe('captureLiveScene — filing the pool into the archive', () => {
  const volatile = (id: number, phase: 'sunrise' | 'sunset') =>
    cam({ webcamId: id, phase, images: { current: { preview: `https://imgproxy.windy.com/${id}.jpg` } } });

  it('archives every frame it newly pinned', async () => {
    fetchTerminatorWebcams.mockResolvedValue([volatile(1, 'sunset'), volatile(2, 'sunrise')]);
    captureWebcamSnapshot.mockImplementation((c: WindyWebcam) =>
      Promise.resolve({ url: `https://storage.googleapis.com/b/${c.webcamId}.jpg`, path: `p/${c.webcamId}` })
    );

    const result = await captureLiveScene();

    expect(result.archived).toBe(2);
    expect(archiveSceneFrame).toHaveBeenCalledTimes(2);
  });

  it('files each frame under its own phase', async () => {
    fetchTerminatorWebcams.mockResolvedValue([volatile(9, 'sunrise')]);
    captureWebcamSnapshot.mockResolvedValue({ url: 'https://storage.googleapis.com/b/9.jpg', path: 'p/9' });

    await captureLiveScene();

    expect(archiveSceneFrame.mock.calls[0][2]).toBe('sunrise');
  });

  it('files an already-durable frame too, without re-uploading it', async () => {
    // The row records that this frame was in the pool at THIS instant, which
    // is a different fact from when the device first uploaded it. Skip it and
    // a pointer scene loses every camera whose last upload predates the
    // window.
    fetchTerminatorWebcams.mockResolvedValue([cam({ webcamId: 5 })]);

    const result = await captureLiveScene();

    expect(captureWebcamSnapshot).not.toHaveBeenCalled();
    expect(archiveSceneFrame).toHaveBeenCalledTimes(1);
    expect(result.archived).toBe(1);
    expect(result.pinned).toBe(0);
  });

  it('reuses the durable frame\'s own storage path rather than inventing one', async () => {
    fetchTerminatorWebcams.mockResolvedValue([cam({ webcamId: 5 })]);
    await captureLiveScene();
    expect(archiveSceneFrame.mock.calls[0][1]).toEqual({
      url: 'https://storage.googleapis.com/sunset-webcam-map.appspot.com/snapshots/1/1700000000000.jpg',
      path: 'snapshots/1/1700000000000.jpg',
    });
  });

  it('counts only the frames that actually landed', async () => {
    fetchTerminatorWebcams.mockResolvedValue([volatile(1, 'sunset'), volatile(2, 'sunset')]);
    captureWebcamSnapshot.mockImplementation((c: WindyWebcam) =>
      Promise.resolve({ url: `https://storage.googleapis.com/b/${c.webcamId}.jpg`, path: `p/${c.webcamId}` })
    );
    archiveSceneFrame.mockResolvedValueOnce(1).mockResolvedValueOnce(null);

    const result = await captureLiveScene();

    expect(result.pinned).toBe(2);
    expect(result.archived).toBe(1);
  });

  it('does not lose the capture when a frame fails to file', async () => {
    fetchTerminatorWebcams.mockResolvedValue([volatile(1, 'sunset')]);
    captureWebcamSnapshot.mockResolvedValue({ url: 'https://storage.googleapis.com/b/1.jpg', path: 'p/1' });
    archiveSceneFrame.mockResolvedValue(null);

    const result = await captureLiveScene();

    expect(result.state.sunset).toHaveLength(1);
    expect(result.archived).toBe(0);
  });
});

describe('firebasePathFromUrl', () => {
  it('strips scheme, host and bucket, leaving the storage path', () => {
    expect(
      firebasePathFromUrl('https://storage.googleapis.com/my-bucket/snapshots/7/123.jpg')
    ).toBe('snapshots/7/123.jpg');
  });

  it('returns empty for a URL it cannot parse, rather than throwing mid-capture', () => {
    expect(firebasePathFromUrl('not a url')).toBe('');
  });
});
