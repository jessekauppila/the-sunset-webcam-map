import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  getCustomCameraLiveState,
  getCustomCameraLiveStatesByWebcamId,
} from './customCameraState';

describe('getCustomCameraLiveState', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns null when no rows match the cameraId', async () => {
    sqlMock.mockResolvedValue([]);

    const result = await getCustomCameraLiveState(999);

    expect(result).toBeNull();
  });

  it('returns full state with latest_snapshot when both camera and snapshot exist', async () => {
    sqlMock.mockResolvedValue([{
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
      latest_snapshot_url: 'https://fb/snap.jpg',
      latest_snapshot_captured_at: new Date('2026-05-14T03:30:00Z'),
    }]);

    const result = await getCustomCameraLiveState(1);

    expect(result).not.toBeNull();
    expect(result!.device_class).toBe('rpi-zero-2w');
    expect(result!.firmware_version).toBe('0.1.0');
    expect(result!.hardware_id).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result!.latest_snapshot).toEqual({
      firebase_url: 'https://fb/snap.jpg',
      captured_at: new Date('2026-05-14T03:30:00Z'),
    });
  });

  it('returns state with null latest_snapshot when camera exists but no snapshots yet', async () => {
    sqlMock.mockResolvedValue([{
      device_class: 'rpi-zero-2w',
      firmware_version: null,
      hardware_id: 'pi-zero-2w-new-build',
      latest_snapshot_url: null,
      latest_snapshot_captured_at: null,
    }]);

    const result = await getCustomCameraLiveState(2);

    expect(result).not.toBeNull();
    expect(result!.firmware_version).toBeNull();
    expect(result!.latest_snapshot).toBeNull();
  });

  it('passes the cameraId as a SQL parameter', async () => {
    sqlMock.mockResolvedValue([]);

    await getCustomCameraLiveState(42);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(42);
  });
});

describe('getCustomCameraLiveStatesByWebcamId', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns an empty Map when called with an empty array (no SQL hit)', async () => {
    const result = await getCustomCameraLiveStatesByWebcamId([]);

    expect(result.size).toBe(0);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns a Map keyed by webcam_id for each row returned by SQL', async () => {
    sqlMock.mockResolvedValue([
      {
        webcam_id: 100,
        device_class: 'rpi-zero-2w',
        firmware_version: '0.1.0',
        hardware_id: 'pi-A',
        latest_snapshot_url: 'https://fb/a.jpg',
        latest_snapshot_captured_at: new Date('2026-05-14T03:00:00Z'),
      },
      {
        webcam_id: 200,
        device_class: 'rpi-zero-2w',
        firmware_version: '0.1.0',
        hardware_id: 'pi-B',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
      },
    ]);

    const result = await getCustomCameraLiveStatesByWebcamId([100, 200, 300]);

    expect(result.size).toBe(2);
    expect(result.get(100)?.hardware_id).toBe('pi-A');
    expect(result.get(100)?.latest_snapshot?.firebase_url).toBe('https://fb/a.jpg');
    expect(result.get(200)?.hardware_id).toBe('pi-B');
    expect(result.get(200)?.latest_snapshot).toBeNull();
    expect(result.has(300)).toBe(false);
  });

  it('passes the webcamIds array to SQL', async () => {
    sqlMock.mockResolvedValue([]);

    await getCustomCameraLiveStatesByWebcamId([1, 2, 3]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContainEqual([1, 2, 3]);
  });
});
