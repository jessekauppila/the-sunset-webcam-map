// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  derivePlacementStatus,
  mintDeviceToken,
  upsertCameraByClaimCode,
} from './cameraRegistration';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('derivePlacementStatus', () => {
  it('returns "ready" when all required placement fields are populated', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      })
    ).toBe('ready');
  });

  it('returns "pending" when lat is null', () => {
    expect(
      derivePlacementStatus({
        lat: null,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      })
    ).toBe('pending');
  });

  it('returns "pending" when azimuth_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: null,
        tilt_deg: 5,
      })
    ).toBe('pending');
  });

  it('returns "pending" when tilt_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: null,
      })
    ).toBe('pending');
  });
});

describe('mintDeviceToken', () => {
  it('returns a hex token and its SHA-256 hash', () => {
    const { plaintext, hash } = mintDeviceToken();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plaintext).not.toBe(hash);
  });

  it('generates a different token each call', () => {
    const a = mintDeviceToken();
    const b = mintDeviceToken();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe('upsertCameraByClaimCode', () => {
  it('inserts a new row when no camera exists for the claim code', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // SELECT existing — none
      .mockResolvedValueOnce([
        {
          id: 17,
          claim_code: 'SUNSET-AAAA-BBBB',
          lat: 47.6,
          lng: -122.3,
          azimuth_deg: 270,
          tilt_deg: 5,
        },
      ]); // INSERT RETURNING

    const row = await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 47.6,
      lng: -122.3,
      timezone: 'America/Los_Angeles',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
      phase_preference: 'sunset',
      delivery_preferences: { type: 'email', target: 'a@b.c', cadence: 'daily' },
    });

    expect(row.id).toBe(17);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('updates the existing row when a camera already exists for the claim code', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { id: 17, claim_code: 'SUNSET-AAAA-BBBB' },
      ]) // SELECT existing — found
      .mockResolvedValueOnce([
        {
          id: 17,
          claim_code: 'SUNSET-AAAA-BBBB',
          lat: 47.6,
          lng: -122.3,
          azimuth_deg: 270,
          tilt_deg: 5,
        },
      ]); // UPDATE RETURNING

    const row = await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 47.6,
      lng: -122.3,
      timezone: 'America/Los_Angeles',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
    });

    expect(row.id).toBe(17);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
