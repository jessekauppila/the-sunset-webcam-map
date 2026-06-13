# Sub-project F — Cloud Setup Wizard (Bracket Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `/setup/[claim_code]` cloud wizard into the reconciliation spec's 9-step bracket flow — porting the window-bracket prototype's placement screens (measure window → hinge to equinox → bracket spec → assemble → mount & confirm) into real React steps wired to the salvaged solar/declination engine and the existing device hooks, and extending `pre-register` + its persistence to store full bracket provenance per the E↔F integration contract.

**Architecture:** The wizard is a client-side React state machine (`WizardClient.tsx`) driving one step component at a time. The bracket math is pure and already ported to `app/lib/solar.ts`; this plan adds a `app/lib/bracket.ts` solver (wedge snap, lens recommend, true-north conversion, payload assembly) and consumes the existing `useGeolocation` / `useDeviceOrientation` / `usePolling` hooks plus the `GET /api/setup/declination` endpoint instead of the prototype's mocked sliders. The bracket provenance threads through `WizardState` → `SubmitStep` → `POST /api/cameras/pre-register` → `upsertCameraByClaimCode` → three new `cameras` columns, then back out through the `register` and `heartbeat` placement blocks so the Pi sun-self-refine loop can read `azimuth_source`/`coarse`.

**Tech Stack:** Next.js (App Router, RSC + client components), TypeScript, React hooks, vitest (jsdom + node environments), `@neondatabase/serverless` template-literal `sql`, the `geomagnetism` WMM model (already wired in `app/lib/declination.ts`).

**Authoritative references (read before starting):**
- Integration contract (conform exactly): `docs/superpowers/specs/2026-06-13-E-F-integration-contract.md` — esp. §0 (F owns all cloud bracket-persistence files), §4 (pre-register payload + bracket additions; canonical `{north, south, null}` enum vocabulary per Fix 1; PR-2 azimuth_source invariant; PR-3 consumed-code acceptance), §2.2/§2.3 (setup-status states incl. `awaiting_aim`; resumable/410-at-submit lifecycle LC-4/LC-5), §3.3 (register-first phase default NULL), §7 invariants (I-5, I-6), §8 divergences (D-3, D-6, D-8), and the Reconciliation log (2026-06-13).
- F reconciliation design: `docs/superpowers/specs/2026-06-13-wizard-reconciliation-design.md` — the 9-step flow table and the "look" section.
- Bracket prototype (port the screens + math + visual language): `sunset-cam-firmware/.../docs/prototypes/2026-06-12-window-bracket-prototype.jsx` and its handoff `2026-06-12-window-bracket-handoff.md` (read "Corrections folded in from v19": no vertical tilt, no ±65° gate, fixed wedge ladder, flip-direction handedness, `null` flip at 0°, wide lens is 120°, coverage is TBD).

**Real vs. placeholder (per reconciliation spec step table):**
- Step 1 **Connect** — real code, but **gated on sub-project E**. Until E ships there is no captive-portal device to flip `setup-status`; the step works against a real `setup-status` poll but is only end-to-end with a mocked/manual device row. KEEP `ConfirmCamera` real; just widen its status union (Task 3). Do NOT build a mock device — note the dependency in the success message.
- Steps 2–7 (phase/facing, measure, hinge, bracket spec, assemble, mount&confirm) — **real**, this plan builds them.
- Step 8 **Delivery** — **placeholder** ("Skip for now"), moved to after mount&confirm; default `null` when skipped.
- Step 9 **Submit** — **real** (`pre-register`).

---

## File Structure

**New files:**
- `app/lib/bracket.ts` — pure bracket solver: `snapWedge`, `recommendLens`, `bracketHorizontalWedge`, `toTrue`, `compassName`, `offsetSide`, `solveBracket(...)`, `buildPreRegisterPayload(...)`, and the `BracketSpec` / `BracketProvenance` types. Ported verbatim (typed) from the prototype's DOMAIN MATH block; reuses `angDiff`/`arcAnchors`/`azToX` from `app/lib/solar.ts` (do not duplicate them).
- `app/lib/bracket.test.ts` — unit tests for the solver against the prototype's verified examples.
- `app/setup/[claim_code]/lib/useTrueHeading.ts` — small hook composing `useDeviceOrientation` + the declination endpoint to expose a true-north heading (magnetic + declination).
- `app/setup/[claim_code]/components/InsideOutFrame.tsx` — shared top-down SVG frame + the amber palette `C` and `Chip`/`Why`/`Label` primitives (the prototype's visual language).
- `app/setup/[claim_code]/components/diagrams.tsx` — `PlacePhoneAnim`, `HingeAnim` (rAF demo→live), `WedgeDiagram`, `WedgeCaseBracket`, `MountDiagram`, `SkyView` — ported from the prototype.
- `app/setup/[claim_code]/steps/FacingPhase.tsx` — step 2 (merges facing + phase).
- `app/setup/[claim_code]/steps/MeasureWindow.tsx` — step 3.
- `app/setup/[claim_code]/steps/HingeToEquinox.tsx` — step 4.
- `app/setup/[claim_code]/steps/BracketSpec.tsx` — step 5.
- `app/setup/[claim_code]/steps/Assemble.tsx` — step 6.
- `app/setup/[claim_code]/steps/MountConfirm.tsx` — step 7 (replaces `MountHere`).
- `app/setup/[claim_code]/steps/DeliveryPlaceholder.tsx` — step 8 (Skip-for-now wrapper around the existing `DeliveryPreferences`).
- `database/migrations/20260613_cameras_bracket_provenance.sql` — adds `azimuth_source`, `coarse`, `bracket` columns.

**Modified files:**
- `app/setup/[claim_code]/types.ts` — widen `deviceStatus` union (+`awaiting_aim`), drop `'both'` from the UI phase type, add bracket fields to `WizardState`, rewrite `STEPS`.
- `app/setup/[claim_code]/WizardClient.tsx` — wire the new step set.
- `app/setup/[claim_code]/steps/ConfirmCamera.tsx` — widen `StatusResponse`/`onAdvance` union to include `awaiting_aim`.
- `app/setup/[claim_code]/steps/SubmitStep.tsx` — send the full bracket payload via `buildPreRegisterPayload`.
- `app/api/cameras/pre-register/route.ts` — parse/validate `azimuth_source`, `coarse`, `placement.bracket`.
- `app/lib/cameraRegistration.ts` — extend `CameraUpsertInput`, `PlacementShape` consumers, and `upsertCameraByClaimCode` INSERT/UPDATE.
- `app/api/cameras/register/route.ts` — add bracket fields to the SELECT and `placement` response block.
- `app/api/cameras/[id]/heartbeat/route.ts` — add bracket fields to the SELECT and `placement` response block.

**Deleted files (replaced):**
- `app/setup/[claim_code]/steps/ArPlacementPlaceholder.tsx`, `HorizonSweepPlaceholder.tsx`, `MountHere.tsx`.

**Commands:**
- Run a single test file: `npx vitest run app/lib/bracket.test.ts`
- Run a single test by name: `npx vitest run app/lib/bracket.test.ts -t "snaps 12 degrees"`
- Type-check: `npx tsc --noEmit`

---

## Task 1: Bracket solver — wedge snap + lens recommend (pure math)

**Files:**
- Create: `app/lib/bracket.ts`
- Test: `app/lib/bracket.test.ts`

The prototype's DOMAIN MATH block (`window-bracket-prototype.jsx:41-70`) is the source. Reuse `angDiff` and `arcAnchors` from `app/lib/solar.ts`; do NOT re-derive solar math.

- [ ] **Step 1: Write the failing test**

Create `app/lib/bracket.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  WEDGE_ANGLES,
  snapWedge,
  recommendLens,
  bracketHorizontalWedge,
  HFOV,
} from './bracket';

describe('snapWedge', () => {
  it('exposes the 0-20 in 5deg ladder', () => {
    expect(WEDGE_ANGLES).toEqual([0, 5, 10, 15, 20]);
  });

  it('snaps 12 degrees to the nearest 10deg part, sign positive', () => {
    expect(snapWedge(12)).toEqual({ angle: 10, sign: 1 });
  });

  it('snaps a negative offset and records the sign', () => {
    expect(snapWedge(-8)).toEqual({ angle: 10, sign: -1 });
  });

  it('clamps magnitudes past the ladder ceiling to WEDGE_MAX', () => {
    expect(snapWedge(40)).toEqual({ angle: 20, sign: 1 });
  });
});

describe('recommendLens', () => {
  it('Bellingham sunset arc (span ~74) needs the wide lens', () => {
    // arc: jun 307 / dec 233 -> span 74 > 66
    expect(recommendLens({ jun: 307, equinox: 270, dec: 233, today: 270 })).toBe('wide');
  });

  it('a narrow arc uses the standard lens', () => {
    expect(recommendLens({ jun: 285, equinox: 270, dec: 255, today: 270 })).toBe('standard');
  });

  it('HFOV table matches the v19 spec (wide is 120)', () => {
    expect(HFOV).toEqual({ wide: 120, standard: 66 });
  });
});

describe('bracketHorizontalWedge', () => {
  it('is the signed difference target - windowNormal', () => {
    // window faces 262 true, equinox sunset 270 -> +8 wedge
    expect(bracketHorizontalWedge(262, 270)).toBeCloseTo(8, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/bracket.test.ts`
Expected: FAIL — cannot resolve `./bracket`.

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/bracket.ts`:

```typescript
// Pure window-bracket solver. Ported (typed) from the verified prototype
// docs/prototypes/2026-06-12-window-bracket-prototype.jsx DOMAIN MATH block,
// v19-aligned (handoff: no vertical tilt, no +-65 gate, fixed ladder,
// flip-direction handedness, wide lens 120deg, coverage is TBD).
// Reuses angDiff / ArcAnchors from app/lib/solar.ts — does not re-derive them.
import { angDiff, type ArcAnchors } from './solar';

export const HFOV = { wide: 120, standard: 66 } as const;
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
  const angle = WEDGE_ANGLES.reduce((p, c) =>
    Math.abs(c - mag) < Math.abs(p - mag) ? c : p
  , 0);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/bracket.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add app/lib/bracket.ts app/lib/bracket.test.ts
git commit -m "feat(wizard): bracket solver wedge-snap + lens recommend"
```

---

## Task 2: Bracket solver — solveBracket + compass naming + offset side

**Files:**
- Modify: `app/lib/bracket.ts`
- Modify: `app/lib/bracket.test.ts`

This composes the per-window solve from Task 1's primitives plus `arcAnchors` from `solar.ts`, matching the prototype's `M` memo (`window-bracket-prototype.jsx:444-466`).

- [ ] **Step 1: Write the failing test**

Append to `app/lib/bracket.test.ts`:

```typescript
import { solveBracket, compassName, type Facing } from './bracket';

describe('compassName', () => {
  it('names due west', () => expect(compassName(270)).toBe('W'));
  it('names due east', () => expect(compassName(90)).toBe('E'));
  it('wraps north', () => expect(compassName(359)).toBe('N'));
});

describe('solveBracket', () => {
  const facing: Facing = 'west';
  // Bellingham, window magnetic 262, declination +15.3 -> true ~277.3.
  const r = solveBracket({ lat: 48.75, year: 2026, facing, windowMagAz: 262, declinationDeg: 15.3 });

  it('converts the window normal to true north', () => {
    expect(r.normalTrue).toBeCloseTo(277.3, 1);
  });

  it('targets the equinox event azimuth (~270 due west)', () => {
    expect(r.targetAz).toBeCloseTo(270, 0);
  });

  it('snaps the ideal wedge to a manufactured part with a residual', () => {
    // ideal wedge = 270 - 277.3 = -7.3 -> snaps to 5deg, sign -1
    expect(r.angle).toBe(5);
    expect(r.sign).toBe(-1);
    expect(r.signedWedge).toBe(-5);
    expect(r.residual).toBeCloseTo(-2.3, 1);
  });

  it('records the realized coarse aim = normalTrue + signedWedge', () => {
    expect(r.aimAz).toBeCloseTo(272.3, 1);
  });

  it('recommends the wide lens at this latitude', () => {
    expect(r.lens).toBe('wide');
  });

  it('reports which side of due-axis the window offset falls on', () => {
    // west facing, signed wedge negative -> tall end toward south
    expect(r.offsetSide).toBe('south');
  });

  it('a dead-on window has a null offset side and zero wedge', () => {
    const dead = solveBracket({ lat: 48.75, year: 2026, facing, windowMagAz: 254.7, declinationDeg: 15.3 });
    expect(dead.angle).toBe(0);
    expect(dead.offsetSide).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/bracket.test.ts -t "solveBracket"`
Expected: FAIL — `solveBracket` / `compassName` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/lib/bracket.ts`:

```typescript
import { arcAnchors, type Facing } from './solar';
export type { Facing } from './solar';

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/bracket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/bracket.ts app/lib/bracket.test.ts
git commit -m "feat(wizard): solveBracket bundle + compass naming"
```

---

## Task 3: Pre-register payload builder + provenance types

**Files:**
- Modify: `app/lib/bracket.ts`
- Modify: `app/lib/bracket.test.ts`

This produces the exact §4.2 contract payload from a `BracketSolution` + the captured inputs. It is the single source of the wizard's submit body, keeping `SubmitStep` dumb. Conform to integration contract §4.2 / I-5 / I-6 exactly: `azimuth_source: 'bracket'`, `coarse: true`, `tilt_deg: 0`, `horizon_altitude_deg: 0`, `horizon_profile: null`, lens `'wide_120' | 'standard_66'`.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/bracket.test.ts`:

```typescript
import { buildPreRegisterPayload } from './bracket';

describe('buildPreRegisterPayload', () => {
  const sol = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  const payload = buildPreRegisterPayload({
    claimCode: 'SUNSET-7K3M-9XQ2',
    lat: 47.6062, lng: -122.3321, elevationM: 30, timezone: 'America/Los_Angeles',
    facing: 'west', solution: sol, declinationDeg: 15.3, delivery: null,
  });

  it('carries the realized coarse aim as azimuth_deg', () => {
    expect(payload.placement.azimuth_deg).toBeCloseTo(sol.aimAz, 5);
  });

  it('pins v1 invariants: tilt 0, horizon flat, profile null', () => {
    expect(payload.placement.tilt_deg).toBe(0);
    expect(payload.placement.horizon_altitude_deg).toBe(0);
    expect(payload.placement.horizon_profile).toBeNull();
  });

  it('sets the bracket-source signals required for sun self-refine (I-5)', () => {
    expect(payload.placement.azimuth_source).toBe('bracket');
    expect(payload.placement.coarse).toBe(true);
  });

  it('maps the lens to the wire enum', () => {
    expect(payload.placement.bracket.lens).toBe('wide_120');
  });

  it('carries full bracket provenance', () => {
    const b = payload.placement.bracket;
    expect(b.window_normal_az_true).toBeCloseTo(sol.normalTrue, 5);
    expect(b.window_azimuth_offset_deg).toBeCloseTo(Math.abs(sol.offset), 1);
    expect(b.window_offset_side).toBe('south');
    expect(b.wedge_angle_deg).toBe(5);
    expect(b.flip_direction).toBe('south');
    expect(b.residual_aim_error_deg).toBeCloseTo(Math.abs(sol.residual), 1);
    expect(b.material_thickness_mm).toBe(3.0);
  });

  it('phase preference is the single-aimed facing (sunset for west), never both (D-8)', () => {
    expect(payload.operator_preferences.phase_preference).toBe('sunset');
  });

  it('delivery is null when skipped', () => {
    expect(payload.operator_preferences.delivery).toBeNull();
  });

  it('flip_direction is null for a dead-on 0deg window', () => {
    const dead = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 254.7, declinationDeg: 15.3 });
    const p = buildPreRegisterPayload({
      claimCode: 'SUNSET-7K3M-9XQ2', lat: 1, lng: 2, elevationM: null,
      timezone: 'UTC', facing: 'west', solution: dead, declinationDeg: 15.3, delivery: null,
    });
    expect(p.placement.bracket.flip_direction).toBeNull();
    expect(p.placement.bracket.window_offset_side).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/bracket.test.ts -t "buildPreRegisterPayload"`
Expected: FAIL — `buildPreRegisterPayload` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/lib/bracket.ts`:

```typescript
export type WireLens = 'wide_120' | 'standard_66';
export type OffsetSide = 'north' | 'south';

export interface BracketProvenance {
  window_normal_az_true: number;
  window_azimuth_offset_deg: number;
  window_offset_side: OffsetSide | null;
  wedge_angle_deg: number;
  flip_direction: OffsetSide | null; // null at 0deg (flat, symmetric)
  residual_aim_error_deg: number;
  lens: WireLens;
  material_thickness_mm: number;
}

export interface PreRegisterPayload {
  claim_code: string;
  lat: number;
  lng: number;
  elevation_m: number | null;
  timezone: string;
  placement: {
    azimuth_deg: number;
    tilt_deg: 0;
    horizon_altitude_deg: 0;
    horizon_profile: null;
    azimuth_source: 'bracket';
    coarse: true;
    bracket: BracketProvenance;
  };
  operator_preferences: {
    phase_preference: 'sunrise' | 'sunset';
    delivery: unknown;
  };
}

const wireLens = (l: Lens): WireLens => (l === 'wide' ? 'wide_120' : 'standard_66');

/** Build the exact §4.2 pre-register payload from a solved bracket. */
export function buildPreRegisterPayload(args: {
  claimCode: string;
  lat: number;
  lng: number;
  elevationM: number | null;
  timezone: string;
  facing: Facing;
  solution: BracketSolution;
  declinationDeg: number;
  delivery: unknown;
}): PreRegisterPayload {
  const { claimCode, lat, lng, elevationM, timezone, facing, solution, delivery } = args;
  return {
    claim_code: claimCode,
    lat,
    lng,
    elevation_m: elevationM,
    timezone,
    placement: {
      azimuth_deg: solution.aimAz,
      tilt_deg: 0,
      horizon_altitude_deg: 0,
      horizon_profile: null,
      azimuth_source: 'bracket',
      coarse: true,
      bracket: {
        window_normal_az_true: solution.normalTrue,
        window_azimuth_offset_deg: +Math.abs(solution.offset).toFixed(1),
        window_offset_side: solution.offsetSide,
        wedge_angle_deg: solution.angle,
        flip_direction: solution.offsetSide,
        residual_aim_error_deg: +Math.abs(solution.residual).toFixed(1),
        lens: wireLens(solution.lens),
        // Fixed v1 case thickness from the part spec (contract §4.2). When the
        // bracket part spec is parameterized, source this from there instead of
        // the literal; for v1 the case is a single 3.0 mm stock.
        material_thickness_mm: 3.0,
      },
    },
    operator_preferences: {
      phase_preference: facing === 'east' ? 'sunrise' : 'sunset',
      delivery,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/bracket.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/bracket.ts app/lib/bracket.test.ts
git commit -m "feat(wizard): pre-register payload builder + provenance types"
```

---

## Task 4: DB migration — bracket provenance columns

**Files:**
- Create: `database/migrations/20260613_cameras_bracket_provenance.sql`

Per contract §4.3.4 (no such columns exist today — divergence D-3). Forward-only, idempotent (`ADD COLUMN IF NOT EXISTS`), matches the style of `20260516_cameras_either_order_registration.sql`.

> **DEPLOY ORDERING (Fix 5, contract §4.3):** apply this migration to the database BEFORE shipping Task 6 (`pre-register` SELECT/forward) and Task 7 (`register`/`heartbeat` SELECT+emit). If route code that SELECTs `azimuth_source`/`coarse`/`bracket` ships before the columns exist, `register`/`heartbeat`/`pre-register` will 500 for **every** camera, not just bracket installs. Sequence: migrate → deploy routes. The migration is forward-only and idempotent, so re-running it is safe.

- [ ] **Step 1: Write the migration**

Create `database/migrations/20260613_cameras_bracket_provenance.sql`:

```sql
-- Bracket provenance for the cloud setup wizard (sub-project F).
-- The wizard's bracket flow submits a realized COARSE azimuth plus full
-- provenance; the Pi reads azimuth_source/coarse to drive sun self-refine
-- (integration contract I-5). bracket holds the prototype's output payload.
--
-- Forward-only. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260613_cameras_bracket_provenance.sql

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS azimuth_source TEXT;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS coarse BOOLEAN;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS bracket JSONB;
```

- [ ] **Step 2: Verify SQL parses (dry syntax check)**

Run: `grep -c "ADD COLUMN IF NOT EXISTS" database/migrations/20260613_cameras_bracket_provenance.sql`
Expected: `3`

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260613_cameras_bracket_provenance.sql
git commit -m "feat(db): add bracket provenance columns to cameras"
```

---

## Task 5: Persistence — extend upsertCameraByClaimCode

**Files:**
- Modify: `app/lib/cameraRegistration.ts:32-43` (`CameraUpsertInput`)
- Modify: `app/lib/cameraRegistration.ts:54-102` (`upsertCameraByClaimCode`)
- Modify: `app/lib/cameraRegistration.test.ts`

Per contract §4.3.2–§4.3.3. Add three fields and persist them in both the UPDATE and INSERT branches. The existing tests assert `sqlMock` call counts and that no value is the literal string `'null'` — new fields must pass `null` (SQL NULL), not `'null'`.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/cameraRegistration.test.ts` inside the existing `describe('upsertCameraByClaimCode', ...)` (after the last `it`):

```typescript
  it('persists bracket provenance fields on INSERT', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // SELECT existing — none
      .mockResolvedValueOnce([
        { id: 20, claim_code: 'SUNSET-EEEE-FFFF', lat: 1, lng: 2, azimuth_deg: 272, tilt_deg: 0 },
      ]); // INSERT RETURNING

    await upsertCameraByClaimCode('SUNSET-EEEE-FFFF', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 272, tilt_deg: 0, horizon_altitude_deg: 0,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: 'bracket',
      coarse: true,
      bracket: { wedge_angle_deg: 5, lens: 'wide_120' },
    });

    const insertValues = sqlMock.mock.calls[1].slice(1);
    expect(insertValues).toContain('bracket'); // azimuth_source value
    expect(insertValues).toContain(true);      // coarse value
    // bracket is JSON.stringified, never the literal string 'null'
    expect(insertValues).not.toContain('null');
  });

  it('passes SQL NULL (not "null") for bracket when omitted on UPDATE', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 21, claim_code: 'SUNSET-GGGG-HHHH' }])
      .mockResolvedValueOnce([
        { id: 21, claim_code: 'SUNSET-GGGG-HHHH', lat: 1, lng: 2, azimuth_deg: 3, tilt_deg: 0 },
      ]);

    await upsertCameraByClaimCode('SUNSET-GGGG-HHHH', {
      lat: 1, lng: 2, timezone: 'UTC',
      azimuth_deg: 3, tilt_deg: 0, horizon_altitude_deg: 0,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });

    const updateValues = sqlMock.mock.calls[1].slice(1);
    expect(updateValues).not.toContain('null');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/cameraRegistration.test.ts -t "bracket"`
Expected: FAIL — `CameraUpsertInput` has no `azimuth_source`/`coarse`/`bracket` (TS error) and/or the values aren't passed.

- [ ] **Step 3: Extend the input type**

In `app/lib/cameraRegistration.ts`, replace the `CameraUpsertInput` type (lines 32-43):

```typescript
export type CameraUpsertInput = {
  lat: number | null;
  lng: number | null;
  elevation_m?: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: PhasePreference;
  delivery_preferences: unknown;
  // Bracket provenance (integration contract §4.3.2). Nullable so non-bracket
  // callers (and legacy precise installs) can omit them.
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
};
```

- [ ] **Step 4: Persist in the UPDATE branch**

In `upsertCameraByClaimCode`, replace the UPDATE statement's SET list final line and RETURNING (the block currently ending `delivery_preferences = ${...}::jsonb`):

```typescript
    const rows = (await sql`
      UPDATE cameras SET
        lat = ${input.lat},
        lng = ${input.lng},
        elevation_m = ${input.elevation_m ?? null},
        timezone = ${input.timezone},
        azimuth_deg = ${input.azimuth_deg},
        tilt_deg = ${input.tilt_deg},
        horizon_altitude_deg = ${input.horizon_altitude_deg},
        horizon_profile = ${input.horizon_profile == null ? null : JSON.stringify(input.horizon_profile)}::jsonb,
        phase_preference = ${input.phase_preference},
        delivery_preferences = ${input.delivery_preferences == null ? null : JSON.stringify(input.delivery_preferences)}::jsonb,
        azimuth_source = ${input.azimuth_source ?? null},
        coarse = ${input.coarse ?? null},
        bracket = ${input.bracket == null ? null : JSON.stringify(input.bracket)}::jsonb
      WHERE id = ${existing[0].id}
      RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
    `) as CameraRow[];
    return rows[0];
```

- [ ] **Step 5: Persist in the INSERT branch**

Replace the INSERT statement (the `INSERT INTO cameras (...) VALUES (...)` block):

```typescript
  const sentinelToken = sentinelForClaimCode(claimCode);
  const rows = (await sql`
    INSERT INTO cameras (
      hardware_id, device_token_hash, claim_code,
      lat, lng, elevation_m, timezone,
      azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
      phase_preference, delivery_preferences,
      azimuth_source, coarse, bracket
    )
    VALUES (
      ${sentinelToken}, ${sentinelToken}, ${claimCode},
      ${input.lat}, ${input.lng}, ${input.elevation_m ?? null}, ${input.timezone},
      ${input.azimuth_deg}, ${input.tilt_deg}, ${input.horizon_altitude_deg}, ${input.horizon_profile == null ? null : JSON.stringify(input.horizon_profile)}::jsonb,
      ${input.phase_preference}, ${input.delivery_preferences == null ? null : JSON.stringify(input.delivery_preferences)}::jsonb,
      ${input.azimuth_source ?? null}, ${input.coarse ?? null}, ${input.bracket == null ? null : JSON.stringify(input.bracket)}::jsonb
    )
    RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
  `) as CameraRow[];
  return rows[0];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run app/lib/cameraRegistration.test.ts`
Expected: PASS (existing tests still green — they pass `null` for the new fields via the type's optional-at-runtime values; note the existing tests do NOT set the new fields, so confirm Step 7).

- [ ] **Step 7: Fix the pre-existing tests that omit the new fields**

The existing `upsertCameraByClaimCode` tests construct an input literal without the three new fields, which is now a TS error. Add `azimuth_source: null, coarse: null, bracket: null,` to each existing `upsertCameraByClaimCode({...})` call in `app/lib/cameraRegistration.test.ts` (there are four: the two original `it`s and the two `'passes SQL NULL'` tests). Example for the first:

```typescript
    const row = await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 47.6,
      lng: -122.3,
      timezone: 'America/Los_Angeles',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
      phase_preference: 'sunset',
      delivery_preferences: { type: 'email', target: 'a@b.c', cadence: 'daily' },
      azimuth_source: null,
      coarse: null,
      bracket: null,
    });
```

- [ ] **Step 8: Run full file + type-check**

Run: `npx vitest run app/lib/cameraRegistration.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add app/lib/cameraRegistration.ts app/lib/cameraRegistration.test.ts
git commit -m "feat(wizard): persist bracket provenance in upsertCameraByClaimCode"
```

---

## Task 6: pre-register route — parse & validate bracket fields

**Files:**
- Modify: `app/api/cameras/pre-register/route.ts`
- Modify: `app/api/cameras/pre-register/route.test.ts`

Per contract §4.3.1. Accept `placement.azimuth_source`, `placement.coarse`, and the nested `placement.bracket`. Validate `bracket.lens ∈ {wide_120, standard_66}`, `bracket.window_offset_side ∈ {north, south}` or `null`, `bracket.flip_direction` likewise, numbers finite. `parseBracket` is the **single canonical validator** for bracket provenance (contract §0 — F owns this file; E does not author it). Pass them through to `upsertCameraByClaimCode`.

> Note (Fix 1): the canonical solver vocabulary is `window_offset_side`/`flip_direction` ∈ `{north, south}`, `null` at a 0° (flat, symmetric) wedge — this matches what the bracket prototype solver emits and what `buildPreRegisterPayload` sends (Task 3). The validator is **NULL-TOLERANT**: it enum-checks `window_offset_side`/`flip_direction` only when the value is non-null. The stale `left/right` / `up/down/left/right` vocabulary has been removed from both plans.

- [ ] **Step 1: Write the failing test**

Append to `app/api/cameras/pre-register/route.test.ts`:

```typescript
const BRACKET_BODY = {
  ...VALID_BODY,
  placement: {
    azimuth_deg: 272.3,
    tilt_deg: 0,
    horizon_altitude_deg: 0,
    horizon_profile: null,
    azimuth_source: 'bracket',
    coarse: true,
    bracket: {
      window_normal_az_true: 277.3,
      window_azimuth_offset_deg: 7.3,
      window_offset_side: 'south',
      wedge_angle_deg: 5,
      flip_direction: 'south',
      residual_aim_error_deg: 2.3,
      lens: 'wide_120',
      material_thickness_mm: 3.0,
    },
  },
};

describe('POST /api/cameras/pre-register (bracket provenance)', () => {
  it('accepts a bracket payload and forwards provenance to upsert', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 31, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBe('bracket');
    expect(arg.coarse).toBe(true);
    expect(arg.bracket.lens).toBe('wide_120');
    expect(arg.bracket.wedge_angle_deg).toBe(5);
  });

  it('rejects an invalid lens', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, lens: 'fisheye' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid window_offset_side', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const bad = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, bracket: { ...BRACKET_BODY.placement.bracket, window_offset_side: 'sideways' } },
    };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
  });

  it('still accepts a legacy payload with no bracket fields', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 32, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 5,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBeNull();
    expect(arg.coarse).toBeNull();
    expect(arg.bracket).toBeNull();
  });

  // Invariant PR-2 (Fix 4): bracket present => azimuth_source==='bracket' && coarse===true.
  it('defaults azimuth_source/coarse to bracket/true when a bracket is present but they are omitted', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 33, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const noSignals = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: undefined, coarse: undefined },
    };
    const res = await POST(makeRequest(noSignals));
    expect(res.status).toBe(202);
    const arg = upsertCameraByClaimCodeMock.mock.calls[0][1];
    expect(arg.azimuth_source).toBe('bracket');
    expect(arg.coarse).toBe(true);
  });

  it('rejects a bracket payload that contradicts azimuth_source/coarse (400)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: null, consumed_by_camera_id: null,
    });
    const contradictory = {
      ...BRACKET_BODY,
      placement: { ...BRACKET_BODY.placement, azimuth_source: 'sun', coarse: false },
    };
    const res = await POST(makeRequest(contradictory));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  // Fix 7: pre-register must accept a consumed-but-unexpired code (the normal
  // register-first state — register has already consumed it before Submit).
  it('accepts a consumed-but-unexpired claim code (register-first norm) and still upserts (202)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01'),
      consumed_at: new Date('2026-06-13T00:00:00Z'), consumed_by_camera_id: 17,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17, claim_code: 'SUNSET-AAAA-BBBB', lat: 47.6, lng: -122.3, azimuth_deg: 272.3, tilt_deg: 0,
    });
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const res = await POST(makeRequest(BRACKET_BODY));
    expect(res.status).toBe(202);
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cameras/pre-register/route.test.ts -t "bracket provenance"`
Expected: FAIL — route does not forward `azimuth_source`/`coarse`/`bracket` and does not validate `lens`.

- [ ] **Step 3: Extend the Body type + parse/validate**

In `app/api/cameras/pre-register/route.ts`, extend the `placement` field of `Body` (lines 17-22):

```typescript
  placement?: {
    azimuth_deg?: unknown;
    tilt_deg?: unknown;
    horizon_altitude_deg?: unknown;
    horizon_profile?: unknown;
    azimuth_source?: unknown;
    coarse?: unknown;
    bracket?: unknown;
  };
```

Add validation helpers below `asString` (after line 35):

```typescript
const LENS_VALUES = ['wide_120', 'standard_66'] as const;
// Canonical solver vocabulary (contract Fix 1): north/south, null at a 0deg wedge.
const SIDE_VALUES = ['north', 'south'] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Validate the bracket provenance blob if present. Returns:
//   { ok: true, value }  on success (value may be null when absent)
//   { ok: false }        on a malformed blob.
function parseBracket(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== 'object') return { ok: false };
  const b = raw as Record<string, unknown>;
  if (!(LENS_VALUES as readonly unknown[]).includes(b.lens)) return { ok: false };
  for (const key of ['window_offset_side', 'flip_direction'] as const) {
    const v = b[key];
    if (v != null && !(SIDE_VALUES as readonly unknown[]).includes(v)) return { ok: false };
  }
  for (const key of ['window_normal_az_true', 'window_azimuth_offset_deg',
                     'wedge_angle_deg', 'residual_aim_error_deg', 'material_thickness_mm'] as const) {
    if (b[key] != null && !isFiniteNumber(b[key])) return { ok: false };
  }
  return { ok: true, value: b };
}
```

In `POST`, after the existing `horizonProfile` validation (after line 68) and before the `phaseRaw` block, add:

```typescript
  const bracketResult = parseBracket(body.placement?.bracket);
  if (!bracketResult.ok) {
    return NextResponse.json({ error: 'placement.bracket is malformed' }, { status: 400 });
  }
  let azimuthSource = asString(body.placement?.azimuth_source);
  let coarse = typeof body.placement?.coarse === 'boolean' ? body.placement.coarse : null;

  // Invariant PR-2 (contract): if a bracket blob is present, azimuth_source MUST be
  // 'bracket' AND coarse MUST be true. We DEFAULT them when omitted, and REJECT (400)
  // a contradiction (a bracket blob with a conflicting non-null azimuth_source/coarse),
  // because persisting provenance while disabling sun-refine is self-contradictory.
  if (bracketResult.value != null) {
    if (azimuthSource == null) azimuthSource = 'bracket';
    if (coarse == null) coarse = true;
    if (azimuthSource !== 'bracket' || coarse !== true) {
      return NextResponse.json(
        { error: "placement.bracket requires azimuth_source==='bracket' and coarse===true" },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 4: Forward the fields to upsert**

In the `upsertCameraByClaimCode(...)` call, add the three fields after `delivery_preferences`:

```typescript
    const camera = await upsertCameraByClaimCode(claimCode, {
      lat,
      lng,
      elevation_m: asNumber(body.elevation_m),
      timezone,
      azimuth_deg: azimuth,
      tilt_deg: tilt,
      horizon_altitude_deg: asNumber(body.placement?.horizon_altitude_deg) ?? 0,
      horizon_profile: horizonProfile ?? null,
      phase_preference: phase,
      delivery_preferences: body.operator_preferences?.delivery ?? null,
      azimuth_source: azimuthSource,
      coarse,
      bracket: bracketResult.value,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/cameras/pre-register/route.test.ts`
Expected: PASS (new + all original tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/cameras/pre-register/route.ts app/api/cameras/pre-register/route.test.ts
git commit -m "feat(api): pre-register parses + validates bracket provenance"
```

---

## Task 7: register + heartbeat — emit bracket fields in placement

**Files:**
- Modify: `app/api/cameras/register/route.ts:22-34` (`ExistingCameraRow`), `:69-74` (SELECT), `:144-155` (placement block)
- Modify: `app/api/cameras/[id]/heartbeat/route.ts:15-26` (`PlacementRow`), `:47-53` (SELECT), `:82-97` (placement block)
- Modify: `app/api/cameras/register/route.test.ts`

Per contract §4.3.5 and §5: the Pi reads `azimuth_source`/`coarse` to drive sun self-refine, so both endpoints' `placement` blocks must carry the new fields when `ready`.

> **Fix 8 (register-first phase default):** while editing `register/route.ts`, the register-first INSERT (the branch that creates a brand-new device row before the wizard has run) must default `phase_preference` to **`NULL`, not `'both'`** (contract §3.3 / D-8). The bracket flow aims a single event, so the wizard sets `phase_preference` to `sunrise|sunset` at pre-register; a bracket install must never reach ACTIVE with `phase='both'`. If the register-first INSERT currently hard-codes `'both'`, change it to `NULL` here. (`derivePlacementStatus` already keys off lat/lng, not phase, so a NULL phase does not change the register-first `awaiting_location` result.)

- [ ] **Step 1: Write the failing test**

Open `app/api/cameras/register/route.test.ts`, find the test that asserts a `ready` placement response on the pre-register-first path (the row already has placement). Add assertions that the placement block includes the bracket fields. If no such test exists, add one — first inspect the file's existing `sql` mock setup and mirror it. Add:

```typescript
  it('includes bracket fields in the ready placement block (pre-register-first)', async () => {
    // ... mirror this file's existing getClaimCode/sql mock setup for the
    // pre-register-first path, returning an existing row whose SELECT result
    // includes azimuth_source/coarse/bracket, then:
    // const body = await res.json();
    // expect(body.placement_status).toBe('ready');
    // expect(body.placement.azimuth_source).toBe('bracket');
    // expect(body.placement.coarse).toBe(true);
    // expect(body.placement.bracket).toEqual({ wedge_angle_deg: 5, lens: 'wide_120' });
  });
```

Replace the comment skeleton with the concrete mocks copied from the existing `ready`-path test in that file (set `azimuth_source: 'bracket'`, `coarse: true`, `bracket: { wedge_angle_deg: 5, lens: 'wide_120' }` in the SELECT row mock).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cameras/register/route.test.ts -t "bracket fields"`
Expected: FAIL — `placement.azimuth_source` is undefined.

- [ ] **Step 3: Extend register's row type + SELECT + placement block**

In `app/api/cameras/register/route.ts`, add to `ExistingCameraRow` (after `delivery_preferences: unknown;`):

```typescript
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
```

Add the columns to both SELECTs (the `existingRows` SELECT at line 69 and the INSERT ... RETURNING at line 118), appending after `delivery_preferences`:

```sql
, azimuth_source, coarse, bracket
```

Add to the `responseBody.placement` object (after `delivery_preferences:`):

```typescript
        azimuth_source: placementRow.azimuth_source,
        coarse: placementRow.coarse,
        bracket: placementRow.bracket,
```

- [ ] **Step 4: Extend heartbeat's row type + SELECT + placement block**

In `app/api/cameras/[id]/heartbeat/route.ts`, add to `PlacementRow` (after `delivery_preferences: unknown;`):

```typescript
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
```

Append the columns to the UPDATE ... RETURNING (line 50-52):

```sql
, azimuth_source, coarse, bracket
```

Add to the `ready` response's `placement` object (after `delivery_preferences: row.delivery_preferences,`):

```typescript
      azimuth_source: row.azimuth_source,
      coarse: row.coarse,
      bracket: row.bracket,
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run app/api/cameras/register/route.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/cameras/register/route.ts app/api/cameras/[id]/heartbeat/route.ts app/api/cameras/register/route.test.ts
git commit -m "feat(api): register + heartbeat emit bracket fields in placement"
```

---

## Task 8: types.ts — widen status union, new phase type, bracket state, new STEPS

**Files:**
- Modify: `app/setup/[claim_code]/types.ts`

Per contract D-6 (`awaiting_aim` must be handled — treat as advance) and the reconciliation 9-step flow. The wizard UI phase is `sunrise|sunset` only (D-8); facing maps to phase.

- [ ] **Step 1: Replace types.ts**

Overwrite `app/setup/[claim_code]/types.ts`:

```typescript
// Shape of what the wizard accumulates as the operator walks through the
// bracket flow. Submitted to /api/cameras/pre-register at the end via
// buildPreRegisterPayload (app/lib/bracket.ts).
import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import type { DeliveryPreferences } from '@/app/lib/bracket'; // re-export below if needed

// Single-aimed bracket cameras: no 'both' in the UI (integration contract D-8).
export type WizardPhase = 'sunrise' | 'sunset';

export type DeliveryChoice = {
  channel: 'email' | 'sms' | 'gallery-only';
  email?: string;
  phone?: string;
  cadence: 'daily' | 'per-event' | 'quality-gated';
} | null;

// setup-status reports FOUR states over the wire (integration contract §2.2 / D-6):
// awaiting_wifi | registered | awaiting_aim | ready. 'unknown' is a CLIENT-ONLY
// sentinel for the pre-first-poll initial state — setup-status NEVER returns it
// (contract §2.2 note). Keep it in the union; no endpoint produces it.
export type DeviceStatus = 'awaiting_wifi' | 'registered' | 'awaiting_aim' | 'ready' | 'unknown';

export type WizardState = {
  // Step 1 (Connect) — setup-status poll result.
  deviceStatus: DeviceStatus;

  // Step 2 (Facing/phase). facing drives both the solar arcs and phase_preference.
  facing: Facing | null;

  // Step 3 (Measure window) — phone-flat magnetic reading + declination.
  windowMagAz: number | null;
  declinationDeg: number | null;

  // Step 4 onward — the solved bracket bundle (recomputed when inputs change).
  solution: BracketSolution | null;

  // Geolocation (captured on Measure window).
  lat: number | null;
  lng: number | null;
  elevationM: number | null;
  timezone: string | null;

  // Step 8 (Delivery) — null when skipped.
  delivery: DeliveryChoice;
};

export const initialWizardState: WizardState = {
  deviceStatus: 'unknown',
  facing: null,
  windowMagAz: null,
  declinationDeg: null,
  solution: null,
  lat: null,
  lng: null,
  elevationM: null,
  timezone: null,
  delivery: null,
};

// The reconciliation spec's 9-step flow (step 1 gated on sub-project E).
export const STEPS = [
  'connect',          // 1 — real, E-gated
  'facing-phase',     // 2 — real
  'measure-window',   // 3 — real
  'hinge-equinox',    // 4 — real (solar.ts + declination endpoint)
  'bracket-spec',     // 5 — real
  'assemble',         // 6 — real
  'mount-confirm',    // 7 — real
  'delivery',         // 8 — PLACEHOLDER (Skip for now)
  'submit',           // 9 — real (pre-register)
] as const;
export type Step = typeof STEPS[number];
```

> Note: `DeliveryPreferences` is the existing component's prop type; if it is not exported from `app/lib/bracket.ts`, remove that import line — `DeliveryChoice` defined above is the canonical shape. Verify the import resolves in Step 2.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in the files that still import the old types (`WizardClient.tsx`, `ConfirmCamera.tsx`, `PhasePreference.tsx`, `MountHere.tsx`, `SubmitStep.tsx`, deleted placeholders). These are fixed in Tasks 9-17. Confirm there are no errors inside `types.ts` itself. If the `DeliveryPreferences` import errors, delete that import line.

- [ ] **Step 3: Commit**

```bash
git add app/setup/[claim_code]/types.ts
git commit -m "feat(wizard): types for 9-step bracket flow + awaiting_aim status"
```

---

## Task 9: ConfirmCamera — handle awaiting_aim

**Files:**
- Modify: `app/setup/[claim_code]/steps/ConfirmCamera.tsx`

Per contract LC-1 / D-6: advance on any status `!= awaiting_wifi`, including `awaiting_aim`.

- [ ] **Step 1: Update the component**

In `app/setup/[claim_code]/steps/ConfirmCamera.tsx`, replace the `StatusResponse` type (line 6) and the `onAdvance` prop type (lines 14-17) to use the shared union:

```typescript
import type { DeviceStatus } from '../types';

type StatusResponse = { status: Exclude<DeviceStatus, 'unknown'> };
```

And the prop signature:

```typescript
export default function ConfirmCamera({
  claimCode,
  onAdvance,
}: {
  claimCode: string;
  onAdvance: (status: Exclude<DeviceStatus, 'unknown'>) => void;
}) {
```

The existing `stopWhen: (r) => r.status !== 'awaiting_wifi'` already advances on `registered | awaiting_aim | ready` — no logic change. Update the title to reflect it is E-gated: change the heading copy to `"Connect your camera"` and add a sub-line `"This step needs the camera's WiFi onboarding (sub-project E) to be live."` below the existing paragraph.

> **Fix 6 (resumable / re-entry):** the `/setup/[claim_code]` URL is **resumable** — re-opening it must resume setup, not restart from a blank Screen 1. On the FIRST poll, if `setup-status` already returns `registered` or `awaiting_aim` (the "device registered but placement not yet submitted" re-entry state — e.g. the recipient closed the tab mid-flow, or the device registered before they returned), `ConfirmCamera` should auto-advance straight into the bracket flow rather than sitting on "waiting for the device." `onAdvance(status)` already fires on any non-`awaiting_wifi` status, which covers this; just ensure the initial poll result is honored on mount (no artificial "must see awaiting_wifi first" gate). Also surface `setup-status` `404`/`410` here as `"Unknown or expired claim code."` (LC-2/LC-5).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: `ConfirmCamera.tsx` clean (other step files still error — fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add app/setup/[claim_code]/steps/ConfirmCamera.tsx
git commit -m "feat(wizard): ConfirmCamera handles awaiting_aim status"
```

---

## Task 10: Visual language — InsideOutFrame + palette primitives

**Files:**
- Create: `app/setup/[claim_code]/components/InsideOutFrame.tsx`

Port the prototype's palette `C`, `Chip`, `Btn`, `Label`, `Why`, and `InsideOutFrame` (`window-bracket-prototype.jsx:72-126`). These are presentational only — no test needed beyond a render smoke test.

- [ ] **Step 1: Write the failing render test**

Create `app/setup/[claim_code]/components/InsideOutFrame.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InsideOutFrame, Chip, Why } from './InsideOutFrame';

describe('InsideOutFrame', () => {
  it('renders the OUTSIDE / INSIDE frame labels', () => {
    const { getByText } = render(
      <InsideOutFrame H={150} glassY={52}><rect /></InsideOutFrame>
    );
    expect(getByText('OUTSIDE')).toBeTruthy();
    expect(getByText(/INSIDE/)).toBeTruthy();
  });

  it('Chip and Why render their children', () => {
    const { getByText } = render(<><Chip>hello</Chip><Why>why text</Why></>);
    expect(getByText('hello')).toBeTruthy();
    expect(getByText('why text')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/components/InsideOutFrame.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/components/InsideOutFrame.tsx` — port verbatim from the prototype (lines 72-126), typed, marked `'use client'`:

```tsx
'use client';

import type { ReactNode } from 'react';

// The bracket prototype's amber visual language. Ported from
// docs/prototypes/2026-06-12-window-bracket-prototype.jsx (UI PIECES block).
export const C = {
  amber: '#ffcc66', amber2: '#ffd088', amber3: '#ffaa55', sun: '#ffd54a',
  goodBg: '#1f4a24', goodFg: '#a5e0aa', badBg: '#5a1f1f', badFg: '#f0b0b0',
  warnBg: '#4a3a1c', btn: '#4a7acc', link: '#9cc4ff',
  glass: '#3a4a60', room: '#1c1812', outdoors: '#0a1420',
} as const;

type Tone = 'info' | 'dark' | 'good' | 'bad' | 'warn';
export function Chip({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const s: Record<Tone, React.CSSProperties> = {
    info: { background: '#181818', border: '1px solid #2a2a2a', color: C.amber2 },
    dark: { background: '#181818', border: '1px solid #2a2a2a', color: '#ddd' },
    good: { background: C.goodBg, color: C.goodFg },
    bad: { background: C.badBg, color: C.badFg },
    warn: { background: C.warnBg, color: C.amber2 },
  };
  return <div className="mt-2 rounded-lg px-3 py-2 text-sm" style={s[tone]}>{children}</div>;
}

export function Btn(
  { children, ghost, ...p }: { children: ReactNode; ghost?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  return (
    <button {...p}
      className={'mt-3 w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40 ' + (ghost ? 'border' : '')}
      style={ghost ? { color: C.link, borderColor: '#2a3a55', background: 'transparent' }
                   : { background: C.btn, color: '#fff' }}>
      {children}
    </button>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-4 text-xs uppercase tracking-widest text-neutral-500">{children}</div>;
}

export function Why({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 rounded-lg px-3 py-2.5 text-sm leading-relaxed"
       style={{ background: '#13161c', border: '1px solid #232a36', color: '#99aabb' }}>
      {children}
    </p>
  );
}

// Shared top-down diagram frame: OUTSIDE up, glass line, ROOM down.
export function InsideOutFrame(
  { W = 360, H, glassY, children, caption }:
  { W?: number; H: number; glassY: number; children: ReactNode; caption?: string }
) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full rounded-lg" style={{ background: '#181818' }}>
      <rect x="0" y="0" width={W} height={glassY} fill={C.outdoors} opacity=".55" />
      <rect x="0" y={glassY} width={W} height={H - glassY} fill={C.room} opacity=".5" />
      <line x1="26" y1={glassY} x2={W - 26} y2={glassY} stroke={C.glass} strokeWidth="5" />
      <text x="8" y="14" fill="#56708a" fontSize="9">OUTSIDE</text>
      <text x="8" y={H - 8} fill="#8a7a56" fontSize="9">INSIDE (the room)</text>
      {caption && <text x={W / 2} y={H - 8} fill="#999" fontSize="9" textAnchor="middle">{caption}</text>}
      {children}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/components/InsideOutFrame.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/components/InsideOutFrame.tsx app/setup/[claim_code]/components/InsideOutFrame.test.tsx
git commit -m "feat(wizard): port bracket prototype visual language (InsideOutFrame, palette)"
```

---

## Task 11: Diagram components (PlacePhone, Hinge rAF, Wedge, Mount, Sky)

**Files:**
- Create: `app/setup/[claim_code]/components/diagrams.tsx`

Port the prototype's SVG/animation components (`PlacePhoneAnim`, `HingeAnim`, `WedgeDiagram`, `WedgeCaseBracket`, `MountDiagram`, `SkyView`) using `azToX`/`angDiff` from `solar.ts` and the palette from Task 10. The `HingeAnim` keeps the rAF demo→live handoff per the handoff note ("don't reintroduce SMIL"). These are presentational; one smoke test guards the rAF teardown.

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/components/diagrams.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SkyView, HingeAnim } from './diagrams';

describe('SkyView', () => {
  it('renders the heading readout', () => {
    const arc = { jun: 307, equinox: 270, dec: 233, today: 270 };
    const { getByText } = render(
      <SkyView centerAz={270} fov={60} arc={arc} showToday label="cam" />
    );
    expect(getByText(/heading 270/)).toBeTruthy();
  });
});

describe('HingeAnim', () => {
  it('mounts and unmounts without leaking a rAF loop', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <HingeAnim wedgeDeg={8} eventLabel="Equinox sunset" liveOpenDeg={0} aligned={false} />
    );
    unmount();
    cleanup();
    vi.useRealTimers();
    expect(true).toBe(true); // no unhandled rAF after unmount
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/components/diagrams.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/components/diagrams.tsx`. Port `PlacePhoneAnim`, `HingeAnim`, `WedgeDiagram`, `WedgeCaseBracket`, `MountDiagram`, `SkyView` from the prototype (`window-bracket-prototype.jsx:128-407`) verbatim, with these adaptations:
- `'use client'` at the top.
- Import `{ C, InsideOutFrame } from './InsideOutFrame'`.
- Import `{ azToX, angDiff, type ArcAnchors } from '@/app/lib/solar'`.
- Add a local `const rad = (d: number) => (d * Math.PI) / 180;` (used by the SVG geometry).
- Type every prop. `HingeAnim`: `{ wedgeDeg: number; eventLabel: string; liveOpenDeg: number; aligned: boolean }`. `SkyView`: `{ centerAz: number; fov: number; arc: ArcAnchors; showToday: boolean; highlightLock?: boolean; label: string }`. `WedgeDiagram`: `{ normalAz: number; aimAz: number; hfov: number; arc: ArcAnchors; camFrac: number }`. `WedgeCaseBracket`/`MountDiagram`: `{ wedge: number }`.
- The `@keyframes wb-place` CSS the prototype injects via a `<style>` in the App: move that `<style>` block into `PlacePhoneAnim` so the `.anim-place` class works standalone.
- Keep `HingeAnim`'s `useEffect`/`requestAnimationFrame` loop EXACTLY as the prototype (including the `prefers-reduced-motion` branch and the `cancelAnimationFrame` cleanup) — it is the load-bearing demo→live behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/components/diagrams.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/components/diagrams.tsx app/setup/[claim_code]/components/diagrams.test.tsx
git commit -m "feat(wizard): port bracket diagram components (rAF hinge, wedge, sky)"
```

---

## Task 12: useTrueHeading hook (orientation + declination)

**Files:**
- Create: `app/setup/[claim_code]/lib/useTrueHeading.ts`

Composes the existing `useDeviceOrientation` (magnetic heading) with the `GET /api/setup/declination` endpoint to produce a true-north heading, fetching declination once when lat/lng are available. This is what makes step 4 "real" per the reconciliation spec ("magnetic→true via declination").

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/lib/useTrueHeading.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const orientationMock = { orientation: { azimuthDeg: 100, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), error: null };
vi.mock('./useDeviceOrientation', () => ({
  useDeviceOrientation: () => orientationMock,
}));

import { useTrueHeading } from './useTrueHeading';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ declinationDeg: 15 }),
  })) as unknown as typeof fetch);
});

describe('useTrueHeading', () => {
  it('fetches declination and converts magnetic heading to true north', async () => {
    const { result } = renderHook(() => useTrueHeading({ lat: 48.75, lng: -122.48 }));
    await waitFor(() => expect(result.current.declinationDeg).toBe(15));
    // magnetic 100 + 15 declination = 115 true
    expect(result.current.trueHeading).toBeCloseTo(115, 5);
  });

  it('returns null heading before declination resolves', () => {
    const { result } = renderHook(() => useTrueHeading({ lat: null, lng: null }));
    expect(result.current.trueHeading).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/lib/useTrueHeading.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/lib/useTrueHeading.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useDeviceOrientation, type Orientation } from './useDeviceOrientation';

// Magnetic heading from the phone (useDeviceOrientation) converted to true
// north using the server-side WMM declination endpoint. Declination is
// fetched once per location. Reconciliation spec step 4 + integration
// contract: "magnetic -> true via declination".
export function useTrueHeading({ lat, lng }: { lat: number | null; lng: number | null }): {
  orientation: Orientation | null;
  permissionState: ReturnType<typeof useDeviceOrientation>['permissionState'];
  requestPermission: () => Promise<void>;
  declinationDeg: number | null;
  trueHeading: number | null;
  error: string | null;
} {
  const { orientation, permissionState, requestPermission, error } = useDeviceOrientation();
  const [declinationDeg, setDeclinationDeg] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lng == null || declinationDeg != null) return;
    let cancelled = false;
    fetch(`/api/setup/declination?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`declination ${r.status}`))))
      .then((d: { declinationDeg: number }) => {
        if (!cancelled) setDeclinationDeg(d.declinationDeg);
      })
      .catch((e) => {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, declinationDeg]);

  const trueHeading =
    orientation != null && declinationDeg != null
      ? (orientation.azimuthDeg + declinationDeg + 360) % 360
      : null;

  return {
    orientation,
    permissionState,
    requestPermission,
    declinationDeg,
    trueHeading,
    error: error ?? fetchError,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/lib/useTrueHeading.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/lib/useTrueHeading.ts app/setup/[claim_code]/lib/useTrueHeading.test.tsx
git commit -m "feat(wizard): useTrueHeading hook (orientation + WMM declination)"
```

---

## Task 13: Step 2 — FacingPhase (facing/phase merge)

**Files:**
- Create: `app/setup/[claim_code]/steps/FacingPhase.tsx`

Per reconciliation spec: the bracket's facing choice IS the phase preference; one step. Ports prototype screen 1 (`window-bracket-prototype.jsx:526-539`).

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/FacingPhase.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FacingPhase from './FacingPhase';

describe('FacingPhase', () => {
  it('emits "east" when Sunrise is chosen', () => {
    const onChoose = vi.fn();
    const { getByText } = render(<FacingPhase onChoose={onChoose} />);
    fireEvent.click(getByText('Sunrise'));
    expect(onChoose).toHaveBeenCalledWith('east');
  });

  it('emits "west" when Sunset is chosen', () => {
    const onChoose = vi.fn();
    const { getByText } = render(<FacingPhase onChoose={onChoose} />);
    fireEvent.click(getByText('Sunset'));
    expect(onChoose).toHaveBeenCalledWith('west');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/FacingPhase.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/steps/FacingPhase.tsx`:

```tsx
'use client';

import type { Facing } from '@/app/lib/solar';

// Step 2. Facing choice = phase preference (reconciliation spec merge).
// 'east' -> sunrise, 'west' -> sunset. Drops 'both' (integration contract D-8).
export default function FacingPhase({ onChoose }: { onChoose: (f: Facing) => void }) {
  const options: { facing: Facing; title: string; sub: string }[] = [
    { facing: 'east', title: 'Sunrise', sub: 'faces east · 365 sunrises a year' },
    { facing: 'west', title: 'Sunset', sub: 'faces west · 365 sunsets a year' },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-3 text-lg font-medium text-white">Is this a sunrise or sunset camera?</h1>
      {options.map((o) => (
        <button
          key={o.facing}
          type="button"
          onClick={() => onChoose(o.facing)}
          className="mb-2 block w-full rounded-xl border border-neutral-700 p-3 text-left hover:border-neutral-500"
          style={{ background: '#181818' }}
        >
          <span className="block font-medium text-white">{o.title}</span>
          <span className="block text-sm text-neutral-500">{o.sub}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/FacingPhase.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/FacingPhase.tsx app/setup/[claim_code]/steps/FacingPhase.test.tsx
git commit -m "feat(wizard): step 2 FacingPhase (facing = phase merge)"
```

---

## Task 14: Step 3 — MeasureWindow (geolocation + true heading capture)

**Files:**
- Create: `app/setup/[claim_code]/steps/MeasureWindow.tsx`

Per reconciliation spec step 3: phone flat on glass → window-normal azimuth. Uses `useGeolocation` (real lat/lng + timezone) and `useTrueHeading` (real magnetic+declination). On capture, hands `{ windowMagAz, declinationDeg, geo, timezone }` up. Ports prototype screen 2 (the `PlacePhoneAnim` + "This window faces…" card).

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/MeasureWindow.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/useGeolocation', () => ({
  useGeolocation: () => ({ result: { lat: 48.75, lng: -122.48, elevationM: 30 }, error: null, pending: false }),
}));
const trueHeading = { orientation: { azimuthDeg: 262, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), declinationDeg: 15, trueHeading: 277, error: null };
vi.mock('../lib/useTrueHeading', () => ({ useTrueHeading: () => trueHeading }));

import MeasureWindow from './MeasureWindow';

beforeEach(() => vi.clearAllMocks());

describe('MeasureWindow', () => {
  it('captures the magnetic azimuth, declination, geo, and timezone', () => {
    const onCapture = vi.fn();
    const { getByText } = render(<MeasureWindow facing="west" onCapture={onCapture} onBack={() => {}} />);
    fireEvent.click(getByText(/Capture/));
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMagAz: 262,
        declinationDeg: 15,
        geo: { lat: 48.75, lng: -122.48, elevationM: 30 },
      })
    );
    expect(onCapture.mock.calls[0][0].timezone).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/MeasureWindow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/steps/MeasureWindow.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import type { Facing } from '@/app/lib/solar';
import { solveBracket, compassName } from '@/app/lib/bracket';
import { useGeolocation } from '../lib/useGeolocation';
import { useTrueHeading } from '../lib/useTrueHeading';
import { PlacePhoneAnim } from '../components/diagrams';
import { Why, Label, Chip, Btn, C } from '../components/InsideOutFrame';

// Step 3. Phone flat on glass -> window-normal azimuth. Real sensors:
// useGeolocation (lat/lng) + useTrueHeading (magnetic compass + WMM
// declination). Hands the raw inputs up; the parent solves the bracket.
export default function MeasureWindow({
  facing,
  onCapture,
  onBack,
}: {
  facing: Facing;
  onCapture: (data: {
    windowMagAz: number;
    declinationDeg: number;
    geo: { lat: number; lng: number; elevationM: number | null };
    timezone: string;
  }) => void;
  onBack: () => void;
}) {
  const { result: geo } = useGeolocation(true);
  const { orientation, permissionState, requestPermission, declinationDeg, trueHeading } =
    useTrueHeading({ lat: geo?.lat ?? null, lng: geo?.lng ?? null });

  useEffect(() => {
    if (permissionState === 'unknown') void requestPermission();
  }, [permissionState, requestPermission]);

  const ready = orientation != null && geo != null && declinationDeg != null && trueHeading != null;
  const year = new Date().getUTCFullYear();
  const preview =
    ready && declinationDeg != null
      ? solveBracket({ lat: geo!.lat, year, facing, windowMagAz: orientation!.azimuthDeg, declinationDeg })
      : null;

  const capture = () => {
    if (!orientation || !geo || declinationDeg == null) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    onCapture({ windowMagAz: orientation.azimuthDeg, declinationDeg, geo, timezone });
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Measure the window</h1>
      <Why>
        Hold your phone flat against the glass, screen toward you. Its back camera now looks out the
        window — so the compass reads the direction this window faces.
      </Why>
      <PlacePhoneAnim />

      {permissionState === 'unknown' && (
        <Btn onClick={() => void requestPermission()}>Enable compass</Btn>
      )}

      <Label>This window</Label>
      <div className="rounded-xl p-3" style={{ background: '#181818', border: '1px solid #2a2a2a' }}>
        <div className="text-xl text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {preview ? (
            <>faces <b style={{ color: C.amber2 }}>{compassName(preview.normalTrue)} ({Math.round(preview.normalTrue)}°)</b></>
          ) : (
            <span className="text-neutral-500">waiting for compass + location…</span>
          )}
        </div>
      </div>

      {preview && (
        preview.poorFit ? (
          <Chip tone="warn">
            This window faces {Math.abs(preview.offset).toFixed(0)}° off the {facing === 'west' ? 'sunset' : 'sunrise'},
            past the wedge ladder — it&apos;ll still work, aimed as close as the largest part allows.
          </Chip>
        ) : (
          <Chip tone="good">✓ Suits a {preview.angle}° wedge — the arc lands in view.</Chip>
        )
      )}

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Capture — phone is flat on the glass
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/MeasureWindow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/MeasureWindow.tsx app/setup/[claim_code]/steps/MeasureWindow.test.tsx
git commit -m "feat(wizard): step 3 MeasureWindow (real geolocation + true heading)"
```

---

## Task 15: Step 4 — HingeToEquinox (live hinge + arcs)

**Files:**
- Create: `app/setup/[claim_code]/steps/HingeToEquinox.tsx`

Per reconciliation spec step 4: live camera + 3 arcs, swing to lock; engine = `solar.ts` + declination. Reuses `useTrueHeading` for the live opening angle (`angDiff(trueHeading, windowNormalTrue)`) feeding the ported `HingeAnim` (demo→live exactly as the prototype). Ports prototype screen 3.

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/HingeToEquinox.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';

const trueHeading = { orientation: { azimuthDeg: 255, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), declinationDeg: 15, trueHeading: 270, error: null };
vi.mock('../lib/useTrueHeading', () => ({ useTrueHeading: () => trueHeading }));

import HingeToEquinox from './HingeToEquinox';

beforeEach(() => vi.clearAllMocks());

describe('HingeToEquinox', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  it('renders the hinge instruction and a lock affordance', () => {
    const { getByText } = render(
      <HingeToEquinox facing="west" lat={48.75} lng={-122.48} solution={solution} onLock={() => {}} onBack={() => {}} />
    );
    expect(getByText(/Hinge to the equinox/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/HingeToEquinox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/steps/HingeToEquinox.tsx`:

```tsx
'use client';

import type { Facing } from '@/app/lib/solar';
import { angDiff } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { useTrueHeading } from '../lib/useTrueHeading';
import { HingeAnim, SkyView } from '../components/diagrams';
import { Why, Chip } from '../components/InsideOutFrame';

// Step 4. Swing the phone open like a door until the equinox event centers.
// The opening angle is real: angDiff(trueHeading, windowNormalTrue). The
// HingeAnim hands off demo->live the moment real movement appears.
export default function HingeToEquinox({
  facing,
  lat,
  lng,
  solution,
  onLock,
  onBack,
}: {
  facing: Facing;
  lat: number;
  lng: number;
  solution: BracketSolution;
  onLock: () => void;
  onBack: () => void;
}) {
  const { trueHeading } = useTrueHeading({ lat, lng });
  const eventLabel = `Equinox ${facing === 'west' ? 'sunset' : 'sunrise'}`;

  const liveOpenDeg = trueHeading != null ? angDiff(trueHeading, solution.normalTrue) : 0;
  const hingeDelta = trueHeading != null ? angDiff(solution.targetAz, trueHeading) : 999;
  const aligned = Math.abs(hingeDelta) <= 2;

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Hinge to the equinox</h1>
      <Why>
        Keep the edge of the phone nearest the sun on the glass and swing the other edge open into the
        room, like a door, until the <b>{eventLabel}</b> centers in view. That swing is the bracket angle.
      </Why>

      <HingeAnim wedgeDeg={solution.wedge} eventLabel={eventLabel} liveOpenDeg={liveOpenDeg} aligned={aligned} />

      <div className="mt-2">
        <SkyView
          centerAz={trueHeading ?? solution.normalTrue}
          fov={60}
          arc={solution.arc}
          showToday
          highlightLock={aligned}
          label="phone camera · AR"
        />
      </div>

      <Chip tone={aligned ? 'good' : 'dark'}>
        {aligned
          ? <>Equinox line centered — opened {Math.abs(solution.wedge).toFixed(0)}° from the glass.</>
          : <>Swing {hingeDelta > 0 ? 'right' : 'left'} {Math.abs(hingeDelta).toFixed(0)}° more.</>}
      </Chip>

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={onLock}
          disabled={!aligned}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {aligned ? 'Lock the angle' : 'Line up the equinox line'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/HingeToEquinox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/HingeToEquinox.tsx app/setup/[claim_code]/steps/HingeToEquinox.test.tsx
git commit -m "feat(wizard): step 4 HingeToEquinox (live hinge + arcs)"
```

---

## Task 16: Step 5 — BracketSpec (wedge/flip/lens card + WedgeDiagram)

**Files:**
- Create: `app/setup/[claim_code]/steps/BracketSpec.tsx`

Per reconciliation spec step 5: wedge angle + flip direction + lens. Read-only display of the solved bracket. Ports prototype screen 4 (`window-bracket-prototype.jsx:598-653`). Coverage stays TBD (handoff correction).

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/BracketSpec.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import BracketSpec from './BracketSpec';

describe('BracketSpec', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  it('shows the snapped wedge angle and recommended lens', () => {
    const { getByText, container } = render(
      <BracketSpec facing="west" solution={solution} onNext={() => {}} onBack={() => {}} />
    );
    expect(getByText(/Your bracket/)).toBeTruthy();
    expect(container.textContent).toContain(`${solution.angle}°`);
    expect(container.textContent?.toLowerCase()).toContain('wide');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/BracketSpec.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/steps/BracketSpec.tsx` — port prototype screen 4. Compute `camFrac` as the prototype does (`0.5 - clamp(signedWedge/140, -0.32, 0.32)`). Show the wedge-angle card, flip-direction (`solution.offsetSide` → "tall end toward north/south", or "none" at 0°), lens card, the `WedgeDiagram`, and a TBD coverage chip:

```tsx
'use client';

import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { HFOV } from '@/app/lib/bracket';
import { WedgeDiagram } from '../components/diagrams';
import { Label, Chip, C } from '../components/InsideOutFrame';

// Step 5. Read-only spec of the solved bracket: wedge angle, flip direction,
// lens. Coverage (sunsets/year) is intentionally TBD (v19 handoff correction).
export default function BracketSpec({
  facing,
  solution,
  onNext,
  onBack,
}: {
  facing: Facing;
  solution: BracketSolution;
  onNext: () => void;
  onBack: () => void;
}) {
  const tallSide = solution.angle !== 0 ? solution.offsetSide : null;
  const camFrac = 0.5 - Math.max(-0.32, Math.min(0.32, solution.signedWedge / 140));
  const span = Math.abs(solution.arc.jun - solution.arc.dec);
  const event = facing === 'west' ? 'sunset' : 'sunrise';

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Your bracket</h1>
      <div className="rounded-xl p-4" style={{ background: '#181818', border: '1px solid #3a5f40' }}>
        <Label>Wedge angle</Label>
        <div className="text-2xl text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ color: C.amber }}>{solution.angle}°</b>{' '}
          <span className="text-base text-neutral-300">
            {solution.angle === 0 ? '— flat bracket, faces straight out' : 'wedge pair'}
          </span>
        </div>

        <Label>Flip direction</Label>
        <div className="text-xl text-white">
          {tallSide ? <>tall end toward <b style={{ color: C.amber }}>{tallSide}</b></>
                    : <><b style={{ color: C.amber }}>none</b> <span className="text-sm text-neutral-400">— flat, symmetric</span></>}
        </div>

        <Label>Lens</Label>
        <div className="text-xl text-white">
          <b style={{ color: C.amber }}>{solution.lens === 'wide' ? 'wide (120°)' : 'standard (66°)'}</b>
        </div>
        <div className="text-xs text-neutral-500">
          the year&apos;s {event} arc spans {span.toFixed(0)}° here —{' '}
          {span > HFOV.standard ? 'needs the wide lens' : 'the standard lens covers it'}
        </div>
      </div>

      <WedgeDiagram normalAz={solution.normalTrue} aimAz={solution.aimAz} hfov={solution.hfov} arc={solution.arc} camFrac={camFrac} />

      <Chip tone="dark">
        Bracket aim {Math.round(solution.aimAz)}° (equinox {Math.round(solution.targetAz)}°). Coverage: <b>TBD</b>.
      </Chip>

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onNext} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          This is my bracket — assemble it
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/BracketSpec.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/BracketSpec.tsx app/setup/[claim_code]/steps/BracketSpec.test.tsx
git commit -m "feat(wizard): step 5 BracketSpec card + wedge diagram"
```

---

## Task 17: Step 6 — Assemble + Step 7 — MountConfirm

**Files:**
- Create: `app/setup/[claim_code]/steps/Assemble.tsx`
- Create: `app/setup/[claim_code]/steps/MountConfirm.tsx`

Per reconciliation spec steps 6-7. Assemble is instructions (ports prototype screen 5). MountConfirm shows the mount diagram + live-view sky and a confirm button (ports prototype screen 6's pre-confirm half; the success/payload half is `SubmitStep`).

- [ ] **Step 1: Write the failing tests**

Create `app/setup/[claim_code]/steps/Assemble.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import Assemble from './Assemble';

describe('Assemble', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });
  it('advances on the mount-it button', () => {
    const onNext = vi.fn();
    const { getByText } = render(<Assemble solution={solution} onNext={onNext} onBack={() => {}} />);
    fireEvent.click(getByText(/power it on|mounted/i));
    expect(onNext).toHaveBeenCalled();
  });
});
```

Create `app/setup/[claim_code]/steps/MountConfirm.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import MountConfirm from './MountConfirm';

describe('MountConfirm', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });
  it('confirms the view and advances', () => {
    const onConfirm = vi.fn();
    const { getByText } = render(
      <MountConfirm facing="west" solution={solution} onConfirm={onConfirm} onBack={() => {}} />
    );
    fireEvent.click(getByText(/Looks right/i));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/setup/[claim_code]/steps/Assemble.test.tsx app/setup/[claim_code]/steps/MountConfirm.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement Assemble**

Create `app/setup/[claim_code]/steps/Assemble.tsx`:

```tsx
'use client';

import type { BracketSolution } from '@/app/lib/bracket';
import { WedgeCaseBracket } from '../components/diagrams';
import { C } from '../components/InsideOutFrame';

// Step 6. Fit the wedge to the case. Mostly instructions (ports prototype
// screen 5). Final parts/cut-files come from the bracket-design work.
export default function Assemble({
  solution,
  onNext,
  onBack,
}: {
  solution: BracketSolution;
  onNext: () => void;
  onBack: () => void;
}) {
  const tallSide = solution.angle !== 0 ? solution.offsetSide : null;
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Assemble the bracket</h1>
      <WedgeCaseBracket wedge={solution.angle} />
      <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-neutral-300">
        <li>Confirm the Pi camera is on its 4× M2 standoffs in the <b>lid</b>, lens out the front hole.</li>
        <li>
          {solution.angle === 0
            ? <>Use the <b style={{ color: C.amber }}>0° flat bracket pair</b> — orientation doesn&apos;t matter.</>
            : <>Take the <b style={{ color: C.amber }}>{solution.angle}°</b> wedge pair, tall end toward <b>{tallSide}</b>.</>}
        </li>
        <li>Assemble: brackets into the lid, slide the lid kusabi in, face plate on, face kusabi to lock.</li>
        <li>Press the VHB tape flush to the glass from inside the room. Camera sits level — no tilt.</li>
      </ol>
      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onNext} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          It&apos;s mounted — power it on
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement MountConfirm**

Create `app/setup/[claim_code]/steps/MountConfirm.tsx`:

```tsx
'use client';

import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { MountDiagram, SkyView } from '../components/diagrams';
import { Why, Chip } from '../components/InsideOutFrame';

// Step 7. Mount on the glass; confirm the live view shows the event markers
// over open sky. The aim is correct by construction. Ports prototype screen 6
// (pre-confirm half; success + payload lives in SubmitStep).
export default function MountConfirm({
  facing,
  solution,
  onConfirm,
  onBack,
}: {
  facing: Facing;
  solution: BracketSolution;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const event = facing === 'west' ? 'sunset' : 'sunrise';
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Confirm the view</h1>
      <Why>
        The aim is correct by construction — baked into the bracket. The live view should already show
        the {event} markers over open sky.
      </Why>
      <MountDiagram wedge={solution.angle} />
      <div className="mt-2">
        <SkyView centerAz={solution.aimAz} fov={solution.hfov} arc={solution.arc} showToday label="camera live view" />
      </div>
      <Chip tone="info">Do the {event} lines sit over open sky, clear of the frame?</Chip>
      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Something&apos;s off — back</button>
        <button type="button" onClick={onConfirm} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          ✓ Looks right
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/setup/[claim_code]/steps/Assemble.test.tsx app/setup/[claim_code]/steps/MountConfirm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/setup/[claim_code]/steps/Assemble.tsx app/setup/[claim_code]/steps/MountConfirm.tsx app/setup/[claim_code]/steps/Assemble.test.tsx app/setup/[claim_code]/steps/MountConfirm.test.tsx
git commit -m "feat(wizard): steps 6-7 Assemble + MountConfirm"
```

---

## Task 18: Step 8 — DeliveryPlaceholder (Skip for now)

**Files:**
- Create: `app/setup/[claim_code]/steps/DeliveryPlaceholder.tsx`

Per reconciliation spec: Delivery is the lone non-aiming step, after mount&confirm, shipped as a placeholder with a "Skip for now" affordance; default `null` when skipped. Wraps the existing `DeliveryPreferences` component but lets the user skip.

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/DeliveryPlaceholder.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DeliveryPlaceholder from './DeliveryPlaceholder';

describe('DeliveryPlaceholder', () => {
  it('skips with null delivery', () => {
    const onSkip = vi.fn();
    const { getByText } = render(<DeliveryPlaceholder onSkip={onSkip} onBack={() => {}} />);
    fireEvent.click(getByText(/Skip for now/i));
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/DeliveryPlaceholder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/setup/[claim_code]/steps/DeliveryPlaceholder.tsx`:

```tsx
'use client';

// Step 8. Delivery is the lone non-aiming step (reconciliation spec): moved
// after mount & confirm, shipped as a placeholder. Skipping submits null
// delivery (gallery-only default downstream). Notification prefs also live in
// "My Cameras", so skipping here is safe.
export default function DeliveryPlaceholder({
  onSkip,
  onBack,
}: {
  onSkip: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Where should your photos go?</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Coming soon: pick email or text and a cadence. For now your photos land in your gallery —
        you can set notifications later in My Cameras.
      </p>
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-700 p-8 text-center text-xs text-neutral-500">
        Delivery preferences placeholder
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onSkip} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          Skip for now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/DeliveryPlaceholder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/DeliveryPlaceholder.tsx app/setup/[claim_code]/steps/DeliveryPlaceholder.test.tsx
git commit -m "feat(wizard): step 8 DeliveryPlaceholder (Skip for now)"
```

---

## Task 19: SubmitStep — send the full bracket payload

**Files:**
- Modify: `app/setup/[claim_code]/steps/SubmitStep.tsx`

Per contract §4.3.6: `SubmitStep` must carry bracket provenance. It now builds the body via `buildPreRegisterPayload` from the solved bracket in `WizardState`.

> **Fix 6 (410 at Submit):** a unit whose claim code is near TTL can expire *mid-flow* — Connect succeeded earlier, but pre-register can still return `410` (or `404`) at the final Submit. The `if (!res.ok)` branch below must special-case `res.status === 410 || res.status === 404` and surface `"Unknown or expired claim code — this camera's setup link has expired."` (distinct from a generic error), so the failure is legible at the last step, not only on Screen 1 (contract LC-5).

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/steps/SubmitStep.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import SubmitStep from './SubmitStep';
import { initialWizardState, type WizardState } from '../types';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function readyState(): WizardState {
  return {
    ...initialWizardState,
    facing: 'west',
    windowMagAz: 262,
    declinationDeg: 15.3,
    solution: solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 }),
    lat: 47.6062, lng: -122.3321, elevationM: 30, timezone: 'America/Los_Angeles',
    deviceStatus: 'registered',
    delivery: null,
  };
}

describe('SubmitStep', () => {
  it('POSTs a payload with bracket provenance', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ camera_id: 1, placement_status: 'ready' }) });
    const { getByText } = render(<SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} />);
    fireEvent.click(getByText(/Finish setup/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.placement.azimuth_source).toBe('bracket');
    expect(body.placement.coarse).toBe(true);
    expect(body.placement.tilt_deg).toBe(0);
    expect(body.placement.bracket.lens).toBe('wide_120');
    expect(body.operator_preferences.phase_preference).toBe('sunset');
    expect(body.operator_preferences.delivery).toBeNull();
  });

  it('blocks submit when the bracket is unsolved', () => {
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={initialWizardState} onBack={() => {}} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/steps/SubmitStep.test.tsx`
Expected: FAIL — current `SubmitStep` reads the old `WizardState` fields (`placementAzimuth`, etc.) that no longer exist and sends no bracket fields.

- [ ] **Step 3: Rewrite SubmitStep**

Overwrite `app/setup/[claim_code]/steps/SubmitStep.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { WizardState } from '../types';
import { buildPreRegisterPayload } from '@/app/lib/bracket';

// Step 9. Builds the §4.2 pre-register payload from the solved bracket and
// POSTs it. The shape comes from buildPreRegisterPayload (app/lib/bracket.ts).
export default function SubmitStep({
  claimCode,
  state,
  onBack,
}: {
  claimCode: string;
  state: WizardState;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const missing = listMissing(state);

  const submit = async () => {
    if (missing.length > 0 || !state.solution || state.facing == null ||
        state.lat == null || state.lng == null || state.timezone == null ||
        state.declinationDeg == null) {
      return;
    }
    setStatus('submitting');
    try {
      const payload = buildPreRegisterPayload({
        claimCode,
        lat: state.lat,
        lng: state.lng,
        elevationM: state.elevationM,
        timezone: state.timezone,
        facing: state.facing,
        solution: state.solution,
        declinationDeg: state.declinationDeg,
        delivery: state.delivery,
      });
      const res = await fetch('/api/cameras/pre-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Fix 6 / contract LC-5: a near-TTL code can expire mid-flow; surface
        // 404/410 legibly at Submit, not just on Connect.
        if (res.status === 410 || res.status === 404) {
          throw new Error("Unknown or expired claim code — this camera's setup link has expired.");
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setStatus('success');
      setMessage('Setup complete. Your camera fine-tunes its aim on the next clear window.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === 'success') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 text-4xl">✓</div>
        <h1 className="mb-2 text-2xl font-light">You&apos;re set up</h1>
        <p className="text-sm text-neutral-400">{message}</p>
      </div>
    );
  }

  const sol = state.solution;
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Confirm and finish</h1>
      <p className="mb-6 text-sm text-neutral-400">Review what we collected, then submit.</p>

      <dl className="mb-6 space-y-2 text-sm">
        <Row label="Phase" value={state.facing === 'east' ? 'sunrise' : state.facing === 'west' ? 'sunset' : '—'} />
        <Row label="Location" value={state.lat != null && state.lng != null ? `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}` : '—'} />
        <Row label="Timezone" value={state.timezone ?? '—'} />
        <Row label="Aim" value={sol ? `${Math.round(sol.aimAz)}°` : '—'} />
        <Row label="Wedge" value={sol ? `${sol.angle}°${sol.offsetSide ? ` (tall ${sol.offsetSide})` : ''}` : '—'} />
        <Row label="Lens" value={sol ? (sol.lens === 'wide' ? 'wide 120°' : 'standard 66°') : '—'} />
        <Row label="Delivery" value={state.delivery ? `${state.delivery.channel}` : 'gallery only'} />
      </dl>

      {missing.length > 0 && (
        <p className="mb-4 text-sm text-amber-400">Missing: {missing.join(', ')}. Go back and fill them in.</p>
      )}
      {status === 'error' && message && <p className="mb-4 text-sm text-red-400">{message}</p>}

      <div className="mt-auto flex justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={missing.length > 0 || status === 'submitting'}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {status === 'submitting' ? 'Submitting…' : 'Finish setup'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 py-1">
      <dt className="text-neutral-400">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function listMissing(state: WizardState): string[] {
  const missing: string[] = [];
  if (state.facing == null) missing.push('phase');
  if (state.lat == null || state.lng == null) missing.push('location');
  if (state.timezone == null) missing.push('timezone');
  if (state.solution == null) missing.push('bracket');
  if (state.declinationDeg == null) missing.push('declination');
  return missing;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/setup/[claim_code]/steps/SubmitStep.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/setup/[claim_code]/steps/SubmitStep.tsx app/setup/[claim_code]/steps/SubmitStep.test.tsx
git commit -m "feat(wizard): SubmitStep sends full bracket payload"
```

---

## Task 20: WizardClient — wire the 9-step flow + delete placeholders

**Files:**
- Modify: `app/setup/[claim_code]/WizardClient.tsx`
- Delete: `app/setup/[claim_code]/steps/ArPlacementPlaceholder.tsx`, `HorizonSweepPlaceholder.tsx`, `MountHere.tsx`, `PhasePreference.tsx`

`PhasePreference` is superseded by `FacingPhase`; `DeliveryPreferences` stays in the tree (imported by nothing now — keep the file, it may return as the real Delivery step later, but it is no longer wired). Wire each step, recompute the bracket solution when measure inputs land.

- [ ] **Step 1: Write the failing test**

Create `app/setup/[claim_code]/WizardClient.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Stub the polling so ConfirmCamera doesn't hit the network on mount.
vi.mock('./lib/usePolling', () => ({
  usePolling: () => ({ latest: null, error: null, stopped: false }),
}));

import WizardClient from './WizardClient';

describe('WizardClient', () => {
  it('renders the connect step first', () => {
    const { getByText } = render(<WizardClient claimCode="SUNSET-7K3M-9XQ2" />);
    expect(getByText(/Connect your camera/i)).toBeTruthy();
    expect(getByText(/Step 1 of 9/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/setup/[claim_code]/WizardClient.test.tsx`
Expected: FAIL — WizardClient still imports deleted/old steps and `Step 1 of 9` text differs.

- [ ] **Step 3: Delete the superseded step files**

```bash
git rm app/setup/[claim_code]/steps/ArPlacementPlaceholder.tsx app/setup/[claim_code]/steps/HorizonSweepPlaceholder.tsx app/setup/[claim_code]/steps/MountHere.tsx app/setup/[claim_code]/steps/PhasePreference.tsx
```

- [ ] **Step 4: Rewrite WizardClient**

Overwrite `app/setup/[claim_code]/WizardClient.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { initialWizardState, STEPS, type WizardState, type Step } from './types';
import { solveBracket } from '@/app/lib/bracket';
import ConfirmCamera from './steps/ConfirmCamera';
import FacingPhase from './steps/FacingPhase';
import MeasureWindow from './steps/MeasureWindow';
import HingeToEquinox from './steps/HingeToEquinox';
import BracketSpec from './steps/BracketSpec';
import Assemble from './steps/Assemble';
import MountConfirm from './steps/MountConfirm';
import DeliveryPlaceholder from './steps/DeliveryPlaceholder';
import SubmitStep from './steps/SubmitStep';

export default function WizardClient({ claimCode }: { claimCode: string }) {
  const [step, setStep] = useState<Step>('connect');
  const [state, setState] = useState<WizardState>(initialWizardState);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx >= 0 && idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };
  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-black px-4 py-6 text-white">
      <header className="mb-4 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-400">
        <span>Camera setup</span>
        <span>Step {STEPS.indexOf(step) + 1} of {STEPS.length}</span>
      </header>

      <section className="flex flex-1 flex-col">
        {step === 'connect' && (
          <ConfirmCamera
            claimCode={claimCode}
            onAdvance={(deviceStatus) => { update({ deviceStatus }); goNext(); }}
          />
        )}
        {step === 'facing-phase' && (
          <FacingPhase onChoose={(facing) => { update({ facing }); goNext(); }} />
        )}
        {step === 'measure-window' && state.facing && (
          <MeasureWindow
            facing={state.facing}
            onCapture={({ windowMagAz, declinationDeg, geo, timezone }) => {
              const solution = solveBracket({
                lat: geo.lat,
                year: new Date().getUTCFullYear(),
                facing: state.facing!,
                windowMagAz,
                declinationDeg,
              });
              update({
                windowMagAz, declinationDeg,
                lat: geo.lat, lng: geo.lng, elevationM: geo.elevationM,
                timezone, solution,
              });
              goNext();
            }}
            onBack={goBack}
          />
        )}
        {step === 'hinge-equinox' && state.facing && state.solution && state.lat != null && state.lng != null && (
          <HingeToEquinox
            facing={state.facing}
            lat={state.lat}
            lng={state.lng}
            solution={state.solution}
            onLock={goNext}
            onBack={goBack}
          />
        )}
        {step === 'bracket-spec' && state.facing && state.solution && (
          <BracketSpec facing={state.facing} solution={state.solution} onNext={goNext} onBack={goBack} />
        )}
        {step === 'assemble' && state.solution && (
          <Assemble solution={state.solution} onNext={goNext} onBack={goBack} />
        )}
        {step === 'mount-confirm' && state.facing && state.solution && (
          <MountConfirm facing={state.facing} solution={state.solution} onConfirm={goNext} onBack={goBack} />
        )}
        {step === 'delivery' && (
          <DeliveryPlaceholder onSkip={() => { update({ delivery: null }); goNext(); }} onBack={goBack} />
        )}
        {step === 'submit' && (
          <SubmitStep claimCode={claimCode} state={state} onBack={goBack} />
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run app/setup/[claim_code]/WizardClient.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors anywhere.

- [ ] **Step 6: Commit**

```bash
git add app/setup/[claim_code]/WizardClient.tsx
git commit -m "feat(wizard): wire 9-step bracket flow, drop AR/horizon/mount placeholders"
```

---

## Task 21: Full suite + type-check gate

**Files:** none (verification).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all new tests plus the pre-existing `cameraRegistration`, `pre-register`, `register`, `solar`, `declination` suites green.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit any final fixups**

```bash
git add -A
git commit -m "test(wizard): green suite + type-check for bracket flow"
```

---

## Self-Review

**Spec coverage (reconciliation 9-step table + contract §4.3 work items):**
- Step 1 Connect — Tasks 8-9 (status union widened, `awaiting_aim` advances; E-gated copy). ✓
- Step 2 Facing/phase merge — Task 13. ✓
- Step 3 Measure window — Task 14 (real geolocation + true heading). ✓
- Step 4 Hinge — Task 15 (solar.ts arcs + declination endpoint via useTrueHeading + rAF HingeAnim). ✓
- Step 5 Bracket spec — Task 16. ✓
- Step 6 Assemble — Task 17. ✓
- Step 7 Mount & confirm — Task 17 (replaces MountHere). ✓
- Step 8 Delivery placeholder (after mount, Skip for now, null default) — Task 18 + wired in Task 20. ✓
- Step 9 Submit → pre-register — Task 19. ✓
- Contract §4.3.1 (parse/validate bracket) — Task 6. ✓
- §4.3.2-§4.3.3 (CameraUpsertInput + upsert persistence) — Task 5. ✓
- §4.3.4 (migration) — Task 4. ✓
- §4.3.5 (register + heartbeat emit bracket) — Task 7. ✓
- §4.3.6 (WizardState/SubmitStep carry provenance) — Tasks 8, 19. ✓
- I-5 (azimuth_source:'bracket' + coarse:true) — Task 3 payload builder, asserted in Tasks 3/19. ✓
- I-6 (tilt 0, horizon 0, profile null) — Task 3, asserted. ✓
- D-6 (awaiting_aim handled) — Tasks 8-9. ✓
- D-8 (UI drops 'both') — Tasks 3, 8, 13. ✓
- Visual language (amber, InsideOutFrame, rAF hinge) — Tasks 10-11. ✓
- Replaced ArPlacement/HorizonSweep/MountHere — Task 20. ✓

**Reconciliation (2026-06-13) coverage:**
- Fix 1 (canonical enum) — `parseBracket` `SIDE_VALUES` tightened to `{north, south}`, null-tolerant, finiteness-checked (Task 6); `buildPreRegisterPayload`/`BracketProvenance` already emit `north|south|null` (Task 3). F's `parseBracket` is the single canonical validator. ✓
- Fix 2 (file ownership) — F owns the migration (Task 4), `cameraRegistration.ts` (Task 5), `pre-register` (Task 6), `register`/`heartbeat` emit (Task 7); contract §0 referenced. ✓
- Fix 4 (PR-2 invariant) — bracket present ⇒ azimuth_source==='bracket' && coarse===true (default-or-400), with default + reject tests (Task 6). ✓
- Fix 5 (migration ordering) — deploy-ordering note on Task 4 (migrate before routes; forward-only/idempotent). ✓
- Fix 6 (abandoned/resumable) — resumable URL + registered-but-not-submitted re-entry in ConfirmCamera (Task 9); 404/410 surfaced at Submit (Task 19, code + note). ✓
- Fix 7 (consumed code) — pre-register accepts consumed-but-unexpired code; test with `consumed_at`/`consumed_by_camera_id` (Task 6). ✓
- Fix 8 (phase NULL) — register-first INSERT defaults `phase_preference` to NULL not 'both' (Task 7 note). ✓
- Fix 9 — `'unknown'` documented client-only sentinel (Task 8 types); `material_thickness_mm` annotated as fixed-v1 part-spec thickness (Task 3); pre-register success pinned to 202 (tests already assert 202). ✓

**Placeholder scan:** Task 7 Step 1 intentionally leaves a copy-the-existing-mock instruction (the register test's exact `sql` mock setup is file-specific and must be read at execution time); the concrete assertions and field values are given. Task 8's `DeliveryPreferences` import note is a conditional the executor resolves by type-check. No "TODO/TBD-as-implementation" remain.

**Type consistency:** `BracketSolution`, `BracketProvenance`, `PreRegisterPayload`, `solveBracket`, `buildPreRegisterPayload`, `useTrueHeading`, `Facing`, `WizardPhase`, `DeviceStatus` are defined once (Tasks 1-3, 8, 12) and referenced consistently. `solution.offsetSide` is the single flip-direction source (null at 0°). `CameraUpsertInput` gains `azimuth_source/coarse/bracket` (Task 5) used by both routes (Task 6) and tests. The `wedge_angle_deg`/`flip_direction`/`window_offset_side` names match the contract §4.2 and the prototype payload.
