// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const computeCameraHealthMock = vi.fn();
const getWindowMock = vi.fn();
const isInWindowNowMock = vi.fn();

vi.mock('@/app/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  return { sql };
});

vi.mock('@/app/lib/cameraHealth', () => ({
  computeCameraHealth: (...a: unknown[]) => computeCameraHealthMock(...a),
  getMostRecentExpectedWindow: (...a: unknown[]) => getWindowMock(...a),
  isInWindowNow: (...a: unknown[]) => isInWindowNowMock(...a),
}));

import { fetchCameraDetail } from './cameraDetail';

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  computeCameraHealthMock.mockReset().mockReturnValue('live');
  getWindowMock.mockReset().mockReturnValue(null);
  isInWindowNowMock.mockReset().mockReturnValue(false);
});

describe('fetchCameraDetail', () => {
  it('returns null when no camera with that id exists', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await fetchCameraDetail(999)).toBeNull();
  });

  it('maps a row to CameraDetail, coercing NUMERIC + ISO dates and computing health', async () => {
    computeCameraHealthMock.mockReturnValue('stale');
    isInWindowNowMock.mockReturnValue(true);
    sqlMock.mockResolvedValue([
      {
        camera_id: 7,
        webcam_id: 42,
        hardware_id: 'sunset-cam-1',
        device_class: 'rpi-zero-2w',
        firmware_version: '0.4.2',
        lat: '48.751900',
        lng: '-122.478700',
        phase_preference: 'sunset',
        status: 'active',
        registered_at: '2026-05-01T00:00:00.000Z',
        last_heartbeat_at: '2026-06-10T04:00:00.000Z',
        title: 'sunset-cam-1',
        latest_snapshot_url: 'https://x/y.jpg',
        latest_snapshot_captured_at: '2026-06-10T04:01:00.000Z',
      },
    ]);
    const d = await fetchCameraDetail(7);
    expect(d).toMatchObject({
      cameraId: 7,
      webcamId: 42,
      title: 'sunset-cam-1',
      hardwareId: 'sunset-cam-1',
      deviceClass: 'rpi-zero-2w',
      firmwareVersion: '0.4.2',
      lat: 48.7519,
      lng: -122.4787,
      phase: 'sunset',
      status: 'active',
      registeredAt: '2026-05-01T00:00:00.000Z',
      lastHeartbeatAt: '2026-06-10T04:00:00.000Z',
      lastSnapshotAt: '2026-06-10T04:01:00.000Z',
      latestSnapshotUrl: 'https://x/y.jpg',
      health: 'stale',
      isInWindowNow: true,
    });
  });

  it('handles a never-reported camera (null webcam_id and null timestamps)', async () => {
    computeCameraHealthMock.mockReturnValue('never');
    sqlMock.mockResolvedValue([
      {
        camera_id: 3,
        webcam_id: null,
        hardware_id: 'barn-cam',
        device_class: 'rpi-zero-2w',
        firmware_version: null,
        lat: '10',
        lng: '20',
        phase_preference: 'both',
        status: 'active',
        registered_at: '2026-05-01T00:00:00.000Z',
        last_heartbeat_at: null,
        title: 'barn-cam',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
      },
    ]);
    const d = await fetchCameraDetail(3);
    expect(d?.webcamId).toBeNull();
    expect(d?.health).toBe('never');
    expect(d?.firmwareVersion).toBeNull();
    expect(d?.lastSnapshotAt).toBeNull();
    expect(d?.latestSnapshotUrl).toBeNull();
  });
});
