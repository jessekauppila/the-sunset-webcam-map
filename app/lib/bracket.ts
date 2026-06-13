// Pure window-bracket solver. Ported (typed) from the verified prototype
// docs/prototypes/2026-06-12-window-bracket-prototype.jsx DOMAIN MATH block,
// v19-aligned (handoff: no vertical tilt, no +-65 gate, fixed ladder,
// flip-direction handedness, coverage is TBD).
// Reuses angDiff / ArcAnchors from app/lib/solar.ts — does not re-derive them.
import { angDiff, type ArcAnchors } from './solar';

// Horizontal FOV per lens. The IMX708 "wide" is 120deg DIAGONAL but ~102deg
// HORIZONTAL; the sunset arc spans horizontally, so the arc/coverage math uses
// the horizontal value (resolved with the operator: Camera Module 3 Wide = 102 H).
export const HFOV = { wide: 102, standard: 66 } as const;
export type Lens = 'wide' | 'standard';

// v19 bracket ladder: discrete azimuth wedges, horizontal only.
// ONE knob — WEDGE_MAX — controls the ceiling (may extend to ~45 later).
export const WEDGE_STEP = 5;
export const WEDGE_MAX = 20;
export const WEDGE_ANGLES: number[] = Array.from(
  { length: WEDGE_MAX / WEDGE_STEP + 1 },
  (_, i) => i * WEDGE_STEP
);

/** Snap a signed ideal wedge to the manufactured ladder. sign drives flip direction. */
export function snapWedge(deg: number): { angle: number; sign: 1 | -1 } {
  const mag = Math.min(WEDGE_MAX, Math.abs(deg));
  const angle = WEDGE_ANGLES.reduce(
    (p, c) => (Math.abs(c - mag) < Math.abs(p - mag) ? c : p),
    0
  );
  return { angle, sign: deg < 0 ? -1 : 1 };
}

const arcSpan = (a: ArcAnchors) => Math.abs(angDiff(a.jun, a.dec));

/** Pick the lens whose horizontal FOV covers the year's event arc. */
export function recommendLens(a: ArcAnchors): Lens {
  return arcSpan(a) > HFOV.standard ? 'wide' : 'standard';
}

/** Convert a magnetic azimuth to true north given east-positive declination. */
export const toTrue = (mag: number, decl: number) => (mag + decl + 360) % 360;

/** Signed horizontal wedge needed: targetAz - windowNormalAz, in (-180, 180]. */
export const bracketHorizontalWedge = (windowNormalAz: number, targetAz: number) =>
  angDiff(targetAz, windowNormalAz);
