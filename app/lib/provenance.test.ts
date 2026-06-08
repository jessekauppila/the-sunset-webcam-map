import { describe, it, expect } from 'vitest';
import { deriveProvenance } from './provenance';

describe('deriveProvenance', () => {
  it('returns flickr for external rows regardless of date', () => {
    expect(deriveProvenance('flickr', '2026-04-01T00:00:00Z')).toBe('flickr');
    expect(deriveProvenance('flickr', null)).toBe('flickr');
  });
  it('returns archive_new for webcam frames captured after the v4 cutoff', () => {
    expect(deriveProvenance('windy', '2026-06-01T00:00:00Z')).toBe('archive_new');
  });
  it('returns archive_trained for webcam frames captured on/before the cutoff', () => {
    expect(deriveProvenance('windy', '2026-05-01T00:00:00Z')).toBe('archive_trained');
  });
  it('treats a null captured_at as trained-era (conservative)', () => {
    expect(deriveProvenance('windy', null)).toBe('archive_trained');
  });
});
