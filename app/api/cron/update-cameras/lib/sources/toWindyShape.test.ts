import { describe, it, expect } from 'vitest';
import { inTickIdFor, toWindyShape } from './toWindyShape';
import type { SourceCamera } from './types';

const cam: SourceCamera = {
  source: 'faa',
  externalId: '10679',
  title: 'Nyac NorthEast',
  lat: 60.97839,
  lng: -160.0021,
  imageUrl: 'https://images.wcams-static.faa.gov/webimages/206/15/10679-1.jpg',
  imageAt: '2026-09-15T02:43:35.049Z',
  azimuthDeg: 45,
  hfovDeg: 90,
  country: 'US',
  region: 'AK',
  city: 'Nyac',
  attribution: null,
  operator: 'FAA Weather Camera Program',
};

describe('toWindyShape', () => {
  it('populates only what the tick reads: identity, location, the frame URL', () => {
    const w = toWindyShape(cam);
    expect(w.source).toBe('faa');
    expect(w.externalId).toBe('10679');
    expect(w.webcamId).toBe(10679);
    expect(w.location).toMatchObject({ latitude: 60.97839, longitude: -160.0021, country: 'US', region: 'AK' });
    expect(w.images?.current.preview).toBe(cam.imageUrl);
    expect(w.title).toBe('Nyac NorthEast');
    expect(w.categories).toEqual([]);
    expect(w.urls).toBeUndefined();
  });

  it('carries a required attribution as the provider url field', () => {
    const w = toWindyShape({ ...cam, attribution: '<a href="https://www.alertwest.org/">ALERTWest</a>' });
    expect(w.urls?.provider).toContain('ALERTWest');
  });
});

describe('inTickIdFor', () => {
  it('uses a numeric external id as-is', () => {
    expect(inTickIdFor({ source: 'faa', externalId: '10679' })).toBe(10679);
  });

  it('hashes a non-numeric id to a stable positive integer', () => {
    const a = inTickIdFor({ source: 'drivebc', externalId: 'hwy1-lytton-e' });
    const b = inTickIdFor({ source: 'drivebc', externalId: 'hwy1-lytton-e' });
    expect(a).toBe(b);
    expect(Number.isSafeInteger(a) && a > 0).toBe(true);
    expect(inTickIdFor({ source: 'nzta', externalId: 'hwy1-lytton-e' })).not.toBe(a);
  });

  it('does not treat a padded or signed numeral as numeric', () => {
    expect(inTickIdFor({ source: 'x', externalId: '007' })).not.toBe(7);
    expect(inTickIdFor({ source: 'x', externalId: '-5' })).toBeGreaterThan(0);
  });
});
