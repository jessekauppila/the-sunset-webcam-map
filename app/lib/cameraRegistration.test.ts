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
