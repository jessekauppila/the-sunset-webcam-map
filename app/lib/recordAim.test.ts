// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sqlMock(strings, ...values),
}));

import { recordAim } from './recordAim';

beforeEach(() => sqlMock.mockReset());

describe('recordAim', () => {
  it('returns null when the code resolves to no camera', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await recordAim('SUNSET-X-Y', { headingDeg: 247, source: 'phone' })).toBeNull();
  });

  it('writes the aim and returns the new azimuth', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, azimuth_deg: 247 }]);
    const out = await recordAim('SUNSET-X-Y', {
      headingDeg: 247,
      source: 'phone',
      lat: 48.75,
      lng: -122.48,
    });
    expect(out).toEqual({ cameraId: 1, azimuthDeg: 247 });
  });

  it('normalizes heading into [0,360) before writing', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, azimuth_deg: 10 }]);
    await recordAim('SUNSET-X-Y', { headingDeg: 370, source: 'phone' });
    const values = sqlMock.mock.calls[0].slice(1); // drop the TemplateStringsArray arg
    expect(values[0]).toBe(10); // 370 → 10
  });
});
