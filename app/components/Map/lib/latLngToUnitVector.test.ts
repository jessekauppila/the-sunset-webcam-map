import { describe, it, expect } from 'vitest';
import { latLngToUnitVector } from './latLngToUnitVector';

describe('latLngToUnitVector', () => {
  it('(0, 0) → (1, 0, 0)', () => {
    const [x, y, z] = latLngToUnitVector(0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('north pole (90, 0) → (0, 1, 0)', () => {
    const [x, y, z] = latLngToUnitVector(90, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('(0, 90) → (0, 0, 1)', () => {
    const [x, y, z] = latLngToUnitVector(0, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('(0, 180) → (-1, 0, 0)', () => {
    const [x, y, z] = latLngToUnitVector(0, 180);
    expect(x).toBeCloseTo(-1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('returns a unit vector for arbitrary inputs', () => {
    const [x, y, z] = latLngToUnitVector(37.5, -122.25);
    const length = Math.sqrt(x * x + y * y + z * z);
    expect(length).toBeCloseTo(1, 6);
  });
});
