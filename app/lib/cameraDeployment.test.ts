// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
import { getActiveDeployment, derivePlacementStatus } from './cameraDeployment';

beforeEach(() => sqlMock.mockReset());

describe('getActiveDeployment', () => {
  it('returns the active (ended_at IS NULL) custom row for a camera', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 9, custom_camera_id: 1, state: 'testing', paused: false,
      lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 }]);
    const d = await getActiveDeployment(1);
    expect(d?.id).toBe(9);
    expect(d?.state).toBe('testing');
  });
  it('returns null when the camera has no active deployment', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getActiveDeployment(1)).toBeNull();
  });
});

describe('derivePlacementStatus', () => {
  it('awaiting_location with no deployment', () => {
    expect(derivePlacementStatus(null)).toBe('awaiting_location');
  });
  it('awaiting_aim when placed but no azimuth', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: null, tilt_deg: null } as never)).toBe('awaiting_aim');
  });
  it('ready when placed + aimed', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 } as never)).toBe('ready');
  });
});
