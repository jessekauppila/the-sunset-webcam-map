import { describe, it, expect } from 'vitest';
import { myCameraToWindyWebcam } from './myCameras';
import type { MyCameraMarker } from './myCameras.types';

const base: MyCameraMarker = {
  markerId: 42,
  cameraId: 7,
  webcamId: 42,
  title: 'deck-west',
  lat: 40,
  lng: -74,
  health: 'stale',
  isInWindowNow: true,
  lastHeartbeatAt: '2026-06-09T04:00:00.000Z',
  lastSnapshotAt: '2026-06-09T04:01:00.000Z',
  latestSnapshotUrl: 'https://x/y.jpg',
  phase: 'sunset',
};

describe('myCameraToWindyWebcam', () => {
  it('maps marker fields into the WindyWebcam shape the marker hook expects', () => {
    const w = myCameraToWindyWebcam(base);
    expect(w.webcamId).toBe(42);
    expect(w.title).toBe('deck-west');
    expect(w.location).toEqual({ latitude: 40, longitude: -74 });
    expect(w.images?.current.preview).toBe('https://x/y.jpg');
    expect(w.cameraHealth).toBe('stale');
    expect(w.isInWindowNow).toBe(true);
    expect(w.phase).toBe('sunset');
  });

  it('omits images when there is no snapshot, and drops phase for "both"', () => {
    const w = myCameraToWindyWebcam({
      ...base,
      latestSnapshotUrl: null,
      phase: 'both',
    });
    expect(w.images).toBeUndefined();
    expect(w.phase).toBeUndefined();
  });
});
