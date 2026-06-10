import { describe, it, expect } from 'vitest';
import { healthVisual } from './cameraHealthVisual';

describe('healthVisual', () => {
  it('maps each health state to a distinct color, badge, and label', () => {
    expect(healthVisual('live')).toEqual({ color: '#37d67a', badge: '✓', label: 'Live' });
    expect(healthVisual('stale')).toEqual({ color: '#f5a623', badge: '!', label: 'Stale' });
    expect(healthVisual('offline')).toEqual({ color: '#e74c3c', badge: '×', label: 'Offline' });
    expect(healthVisual('never')).toEqual({ color: '#8a93a3', badge: '?', label: 'Never reported' });
  });
});
