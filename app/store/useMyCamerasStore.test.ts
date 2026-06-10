import { describe, it, expect, beforeEach } from 'vitest';
import { useMyCamerasStore } from './useMyCamerasStore';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

const cam: MyCameraMarker = {
  markerId: 1, cameraId: 1, webcamId: 1, title: 'a', lat: 0, lng: 0,
  health: 'live', isInWindowNow: false, lastHeartbeatAt: null,
  lastSnapshotAt: null, latestSnapshotUrl: null, phase: 'both',
};

beforeEach(() => {
  useMyCamerasStore.setState({ cameras: [], loading: false, error: undefined });
});

describe('useMyCamerasStore', () => {
  it('sets cameras, loading, and error', () => {
    useMyCamerasStore.getState().setCameras([cam]);
    useMyCamerasStore.getState().setLoading(true);
    useMyCamerasStore.getState().setError('boom');
    const s = useMyCamerasStore.getState();
    expect(s.cameras).toHaveLength(1);
    expect(s.loading).toBe(true);
    expect(s.error).toBe('boom');
  });
});
