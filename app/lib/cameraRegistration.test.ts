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
  sentinelForClaimCode,
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

  it('returns "awaiting_location" when lat is null', () => {
    expect(
      derivePlacementStatus({
        lat: null,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      })
    ).toBe('awaiting_location');
  });

  it('returns "awaiting_aim" when azimuth_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: null,
        tilt_deg: 5,
      })
    ).toBe('awaiting_aim');
  });

  it('returns "awaiting_aim" when tilt_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: null,
      })
    ).toBe('awaiting_aim');
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
      azimuth_source: null,
      coarse: null,
      bracket: null,
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
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });

    expect(row.id).toBe(17);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('passes SQL NULL (not the string "null") for horizon_profile and delivery_preferences on UPDATE', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 17, claim_code: 'SUNSET-AAAA-BBBB' }])
      .mockResolvedValueOnce([
        { id: 17, claim_code: 'SUNSET-AAAA-BBBB', lat: null, lng: null, azimuth_deg: null, tilt_deg: null },
      ]);

    await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 3, tilt_deg: 4, horizon_altitude_deg: 5,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });

    // sqlMock.mock.calls[1] is the UPDATE call. Index 0 is the strings TemplateStringsArray;
    // remaining indices are the interpolated values, in order.
    const updateValues = sqlMock.mock.calls[1].slice(1);
    // No value should ever be the string 'null' — that would be the bug.
    expect(updateValues).not.toContain('null');
  });

  it('passes SQL NULL (not the string "null") for horizon_profile and delivery_preferences on INSERT', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // SELECT — none
      .mockResolvedValueOnce([
        { id: 18, claim_code: 'SUNSET-CCCC-DDDD', lat: 1, lng: 2, azimuth_deg: 3, tilt_deg: 4 },
      ]);

    await upsertCameraByClaimCode('SUNSET-CCCC-DDDD', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 3, tilt_deg: 4, horizon_altitude_deg: 5,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });

    const insertValues = sqlMock.mock.calls[1].slice(1);
    expect(insertValues).not.toContain('null');
  });

  it('persists bracket provenance fields on INSERT', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // SELECT existing — none
      .mockResolvedValueOnce([
        { id: 20, claim_code: 'SUNSET-EEEE-FFFF', lat: 1, lng: 2, azimuth_deg: 272, tilt_deg: 0 },
      ]); // INSERT RETURNING

    await upsertCameraByClaimCode('SUNSET-EEEE-FFFF', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 272, tilt_deg: 0, horizon_altitude_deg: 0,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: 'bracket',
      coarse: true,
      bracket: { wedge_angle_deg: 5, lens: 'wide_120' },
    });

    const insertValues = sqlMock.mock.calls[1].slice(1);
    expect(insertValues).toContain('bracket'); // azimuth_source value
    expect(insertValues).toContain(true);      // coarse value
    expect(insertValues).not.toContain('null');
  });

  it('passes SQL NULL (not "null") for bracket when omitted on UPDATE', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 21, claim_code: 'SUNSET-GGGG-HHHH' }])
      .mockResolvedValueOnce([
        { id: 21, claim_code: 'SUNSET-GGGG-HHHH', lat: 1, lng: 2, azimuth_deg: 3, tilt_deg: 0 },
      ]);

    await upsertCameraByClaimCode('SUNSET-GGGG-HHHH', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 3, tilt_deg: 0, horizon_altitude_deg: 0,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });

    const updateValues = sqlMock.mock.calls[1].slice(1);
    expect(updateValues).not.toContain('null');
  });
});

describe('sentinelForClaimCode', () => {
  it('returns the pending-<code> shape', () => {
    expect(sentinelForClaimCode('SUNSET-AAAA-BBBB')).toBe('pending-SUNSET-AAAA-BBBB');
  });
});

describe('derivePlacementStatus (three states)', () => {
  it('awaiting_location when lat or lng missing', () => {
    expect(derivePlacementStatus({ lat: null, lng: null, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_location');
    expect(derivePlacementStatus({ lat: 48.7, lng: null, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_location');
  });
  it('awaiting_aim when located but not aimed', () => {
    expect(derivePlacementStatus({ lat: 48.7, lng: -122.4, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_aim');
  });
  it('ready when located and aimed', () => {
    expect(derivePlacementStatus({ lat: 48.7, lng: -122.4, azimuth_deg: 270, tilt_deg: 2 }))
      .toBe('ready');
  });
});
