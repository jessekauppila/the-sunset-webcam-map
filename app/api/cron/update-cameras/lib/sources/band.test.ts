import { describe, it, expect } from 'vitest';
import { withinSweptBoxes } from './band';

describe('withinSweptBoxes', () => {
  const within = withinSweptBoxes([{ lat: 60, lng: -150 }, { lat: -30, lng: 20 }], 11);

  it('accepts a point inside a ring box and rejects one outside every box', () => {
    expect(within(65, -145)).toBe(true);
    expect(within(-35, 25)).toBe(true);
    expect(within(45, -150)).toBe(false); // 15° south of the first box
    expect(within(60, -120)).toBe(false); // 30° east of it
  });

  it('is inclusive at the box edge, like a bounding-box query', () => {
    expect(within(71, -150)).toBe(true);
    expect(within(71.0001, -150)).toBe(false);
  });

  it('clamps at the antimeridian instead of wrapping', () => {
    // A box around lng 175 stops at 180; -179 is on the far side and is NOT
    // inside, which matches what the Windy query actually asked for.
    const edge = withinSweptBoxes([{ lat: 0, lng: 175 }], 11);
    expect(edge(0, 179.9)).toBe(true);
    expect(edge(0, -179)).toBe(false);
  });

  it('matches nothing with no ring coordinates', () => {
    expect(withinSweptBoxes([], 11)(0, 0)).toBe(false);
  });
});
