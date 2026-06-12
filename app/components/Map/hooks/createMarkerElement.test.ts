import { describe, it, expect } from 'vitest';
import { createMarkerElement } from './useSetWebcamMarkers';
import type { WindyWebcam } from '@/app/lib/types';

const base: WindyWebcam = {
  webcamId: 1,
  title: 'cam',
  viewCount: 0,
  status: 'active',
  location: { latitude: 0, longitude: 0 },
  categories: [],
};

describe('createMarkerElement', () => {
  it('does NOT set an inline position on the wrapper (Mapbox owns marker positioning)', () => {
    // Regression guard: an inline `position` on the marker element overrides
    // Mapbox's `.mapboxgl-marker { position: absolute }`, dropping every marker
    // out of absolute positioning into normal document flow — the "markers
    // stacked off-globe" bug. The wrapper must leave positioning to Mapbox.
    const el = createMarkerElement(base);
    expect(el.style.position).toBe('');
  });

  it('renders no health badge for a normal windy webcam', () => {
    const el = createMarkerElement(base);
    expect(el.querySelector('.webcam-marker-badge')).toBeNull();
  });

  it('still renders the health badge for a custom camera', () => {
    const el = createMarkerElement({ ...base, cameraHealth: 'live' });
    expect(el.querySelector('.webcam-marker-badge')).not.toBeNull();
  });
});
