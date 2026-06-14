import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const orientationMock = { orientation: { azimuthDeg: 100, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), error: null };
vi.mock('./useDeviceOrientation', () => ({
  useDeviceOrientation: () => orientationMock,
}));

import { useTrueHeading } from './useTrueHeading';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ declinationDeg: 15 }),
  })) as unknown as typeof fetch);
});

describe('useTrueHeading', () => {
  it('fetches declination and converts magnetic heading to true north', async () => {
    const { result } = renderHook(() => useTrueHeading({ lat: 48.75, lng: -122.48 }));
    await waitFor(() => expect(result.current.declinationDeg).toBe(15));
    // magnetic 100 + 15 declination = 115 true
    expect(result.current.trueHeading).toBeCloseTo(115, 5);
  });

  it('returns null heading before declination resolves', () => {
    const { result } = renderHook(() => useTrueHeading({ lat: null, lng: null }));
    expect(result.current.trueHeading).toBeNull();
  });
});
