// Pure window-bracket solver. Ported (typed) from the verified prototype
// docs/prototypes/2026-06-12-window-bracket-prototype.jsx DOMAIN MATH block,
// v19-aligned (handoff: no vertical tilt, no +-65 gate, fixed ladder,
// flip-direction handedness, coverage is TBD).
// Reuses angDiff / ArcAnchors from app/lib/solar.ts — does not re-derive them.
import { angDiff, arcAnchors, type ArcAnchors, type Facing } from './solar';
export type { Facing } from './solar';

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

const WINDS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
/** 16-point compass name for a true azimuth. */
export const compassName = (az: number) =>
  WINDS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

export interface BracketSolution {
  arc: ArcAnchors;
  lens: Lens;
  hfov: number;
  normalTrue: number;     // window facing, true north
  targetAz: number;       // equinox event azimuth (the aim target)
  wedge: number;          // signed ideal wedge (deg)
  angle: number;          // snapped magnitude on the ladder
  sign: 1 | -1;
  signedWedge: number;    // angle * sign
  residual: number;       // wedge - signedWedge (absorbed by lens + sun refine)
  aimAz: number;          // realized COARSE aim = normalTrue + signedWedge
  offset: number;         // == wedge, named for the contract
  offsetSide: 'north' | 'south' | null; // flip direction; null at 0deg
  poorFit: boolean;       // past the ladder ceiling -> advisory, not blocked
}

/** Solve the full per-window bracket bundle (the prototype's `M` memo). */
export function solveBracket(args: {
  lat: number;
  year: number;
  facing: Facing;
  windowMagAz: number;
  declinationDeg: number;
}): BracketSolution {
  const { lat, year, facing, windowMagAz, declinationDeg } = args;
  const arc = arcAnchors(lat, year, facing);
  const lens = recommendLens(arc);
  const hfov = HFOV[lens];
  const normalTrue = toTrue(windowMagAz, declinationDeg);
  const targetAz = arc.equinox;
  const wedge = bracketHorizontalWedge(normalTrue, targetAz);
  const { angle, sign } = snapWedge(wedge);
  const signedWedge = angle * sign;
  const residual = wedge - signedWedge;
  const aimAz = (normalTrue + signedWedge + 360) % 360;
  const offset = wedge;
  const offsetSide =
    Math.abs(offset) < 0.5 || angle === 0
      ? null
      : facing === 'west'
        ? offset >= 0 ? 'north' : 'south'
        : offset >= 0 ? 'south' : 'north';
  const poorFit = Math.abs(wedge) > WEDGE_MAX + 2;
  return { arc, lens, hfov, normalTrue, targetAz, wedge, angle, sign,
           signedWedge, residual, aimAz, offset, offsetSide, poorFit };
}
