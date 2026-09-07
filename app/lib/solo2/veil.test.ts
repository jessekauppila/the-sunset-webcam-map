import { describe, it, expect } from 'vitest';
import { ARRIVAL_EASES, VEIL_TINTS, arrivalLook, bezierPoints, easingIsSymmetric } from './veil';
import type { Solo2Dials } from './types';

const D: Pick<Solo2Dials, 'veilStyle' | 'veilTint' | 'burnLift' | 'veilCovers' | 'arrivalEase'> = {
  veilStyle: 'black', veilTint: 'dawn', burnLift: 1.6, veilCovers: 'picture', arrivalEase: 'gentle',
};

describe('the four looks, per screen', () => {
  it('black is what both screens do today', () => {
    expect(arrivalLook('sunrise', D)).toMatchObject({ veilColor: '#000000', lift: 1 });
    expect(arrivalLook('sunset', D)).toMatchObject({ veilColor: '#000000', lift: 1 });
  });

  it('crossfade takes the veil off the sunrise screen and leaves the sunset one ending in black', () => {
    const d = { ...D, veilStyle: 'crossfade' as const };
    expect(arrivalLook('sunrise', d).veilColor).toBeNull();
    expect(arrivalLook('sunset', d).veilColor).toBe('#000000');
  });

  it('lift dips a sunrise through the chosen tint; the sunset screen never changes colour', () => {
    const d = { ...D, veilStyle: 'lift' as const };
    expect(arrivalLook('sunrise', d).veilColor).toBe(VEIL_TINTS.dawn);
    expect(arrivalLook('sunrise', { ...d, veilTint: 'dim' }).veilColor).toBe(VEIL_TINTS.dim);
    expect(arrivalLook('sunset', { ...d, veilTint: 'dim' }).veilColor).toBe('#000000');
  });

  it('exposure moves each picture toward its own veil: up into white, down into black', () => {
    const d = { ...D, veilStyle: 'exposure' as const };
    expect(arrivalLook('sunrise', d)).toMatchObject({ veilColor: '#ffffff', lift: 1.6 });
    expect(arrivalLook('sunset', d)).toMatchObject({ veilColor: '#000000', lift: 0 });
    // A lift below 1 on the sunrise screen would darken it into a white veil, which is nonsense.
    expect(arrivalLook('sunrise', { ...d, burnLift: 0.2 }).lift).toBe(1);
  });

  it('an unknown style falls back to black rather than to no veil at all', () => {
    expect(arrivalLook('sunrise', { ...D, veilStyle: 'nonsense' as never }).veilColor).toBe('#000000');
  });
});

describe('the easing both halves of a dissolve share', () => {
  it('every curve on offer is point-symmetric, which is what keeps the pair matched', () => {
    // The guard on PR #160's bug: an eased arrival against a linear departure
    // lands in a third of the time it left in. A symmetric curve run in
    // reverse is the same curve, so a pair using one cannot drift apart.
    for (const [name, css] of Object.entries(ARRIVAL_EASES)) {
      expect(easingIsSymmetric(css), `${name} (${css}) must be symmetric`).toBe(true);
    }
  });

  it('recognises an asymmetric curve, so a future one cannot be added quietly', () => {
    expect(easingIsSymmetric('cubic-bezier(0.4, 0, 0.2, 1)')).toBe(false); // the standard "ease-out"
    expect(easingIsSymmetric('ease-in-out')).toBe(false); // a keyword we cannot verify
    expect(bezierPoints('cubic-bezier(0.4, 0, 0.6, 1)')).toEqual([0.4, 0, 0.6, 1]);
    expect(bezierPoints('linear')).toBeNull();
  });

  it('the look carries one timing function for every layer of the change', () => {
    expect(arrivalLook('sunrise', D).ease).toBe(ARRIVAL_EASES.gentle);
    expect(arrivalLook('sunset', { ...D, arrivalEase: 'linear' }).ease).toBe('linear');
    expect(arrivalLook('sunset', { ...D, arrivalEase: 'nonsense' as never }).ease).toBe('linear');
  });
});
