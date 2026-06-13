// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sqlMock(strings, ...values),
}));

import { getCameraByClaimCode } from './setupCamera';

beforeEach(() => sqlMock.mockReset());

describe('getCameraByClaimCode', () => {
  it('returns null when no camera has that claim code', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getCameraByClaimCode('SUNSET-AAAA-BBBB')).toBeNull();
  });

  it('coerces numeric columns and defaults phase to sunset', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 1, lat: '48.7519', lng: '-122.4787', phase_preference: null, azimuth_deg: null },
    ]);
    const cam = await getCameraByClaimCode('SUNSET-AAAA-BBBB');
    expect(cam).toEqual({
      cameraId: 1,
      lat: 48.7519,
      lng: -122.4787,
      phase: 'sunset',
      azimuthDeg: null,
    });
  });

  it('preserves sunrise phase and numeric azimuth', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 2, lat: 40, lng: -120, phase_preference: 'sunrise', azimuth_deg: '91.5' },
    ]);
    const cam = await getCameraByClaimCode('SUNSET-CCCC-DDDD');
    expect(cam).toEqual({ cameraId: 2, lat: 40, lng: -120, phase: 'sunrise', azimuthDeg: 91.5 });
  });
});
