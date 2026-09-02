# Mosaic v2 Static Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fresh mosaic composition in `app/components/mosaic/v2/` that arranges sunset frames by true latitude and depth-into-twilight, sized by the ML quality signal, entirely driven by a settings schema so every judgment call is a `/studio` dial rather than a deploy.

**Architecture:** A pure layout engine (`v2/engine/*`, no DOM) turns `TileInput[]` + a `V2Config` into a `Layout`, and a thin React shell (`useLoadedTiles` → `MosaicCanvas` → overlays) renders it. The pipeline is fixed — signal → visibility → sizing → rows → vertical placement → horizontal placement → overflow — and only stage *behavior* varies, expressed as enums and numbers in `V2_SETTINGS_SCHEMA`. v1 is untouched and stays the frozen reference; v2 ships alongside it behind `?v=v2`.

**Tech Stack:** TypeScript, React 19 / Next.js (App Router, client components), `suncalc` (already a dependency), Canvas 2D for rendering, Vitest + jsdom for tests.

**Spec:** `docs/superpowers/specs/2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md` (binding) plus `docs/superpowers/specs/2026-09-01-mosaic-v2-phase2-composition-decisions.md` (resolves what the spec left open). **Executors must read both.**

## Global Constraints

- **No worktrees.** Plain branches in the single main checkout (`CLAUDE.md`). Work on `feat/mosaic-v2-composition`.
- **Verify the branch before every commit** — `git rev-parse --abbrev-ref HEAD`. Jesse merges PRs in parallel sessions and the branch can shift mid-task. If it is not `feat/mosaic-v2-composition`, STOP and report.
- **Never `git add -A` / `git add .`.** Other sessions have unrelated files staged in this shared checkout (currently ML migrations and `ml/` artifacts). Stage only the explicit paths each task names.
- **v1 is frozen.** Do not edit anything under `app/components/mosaic/v1/`. Copy patterns, never import v1 engine code into v2.
- **Never read canvas pixels back.** Frames come from `storage.googleapis.com`, which serves NO CORS headers; the canvas is tainted by design. `drawImage` only — no `getImageData`, no `toDataURL`.
- **Normalized, not raw.** `gateThreshold` is a probability in `[0,1]`. Stored ratings are on the 1–5 scale. Convert with `1 + t * 4`. Getting this backwards produced the 35k-rows-zero-positives bug.
- **Neon returns NUMERIC as strings.** Anything numeric off the wire goes through `Number()`.
- **Gate-failers pin to the EXACT floor.** They never spread across the sizing curve. Only gate-passers spread. This is a fixed directive, not a knob.
- **No composition constants.** Any number that is a judgment call belongs in `V2_SETTINGS_SCHEMA`, not in source.
- Run tests with `npm run test -- --run <path>`. Lint with `npm run lint`.
- Every schema default must equal the value the code uses when no setting is present.

---

## File Structure

**Created — pure engine (no DOM, fully unit-tested):**

| File | Responsibility |
|---|---|
| `app/components/mosaic/v2/engine/types.ts` | `TileInput`, `SizedTile`, `Row`, `PlacedRow`, `PlacedTile`, `Layout`, `V2Config` |
| `app/components/mosaic/v2/solarPosition.ts` | `sunAltitudeDeg(at, lat, lng)` — thin typed wrapper over `suncalc` |
| `app/components/mosaic/v2/qualitySignal.ts` | `readSignal(webcam, source, gateThreshold)` → `{ passes, score }`; owns the 1–5 ↔ [0,1] conversion |
| `app/components/mosaic/v2/engine/visibility.ts` | Split pool into passers/failers, apply `failedCamPolicy` (`hide`/`showAtFloor`) and `maxTiles` |
| `app/components/mosaic/v2/engine/sizing.ts` | Curve → height; floor-pin for failers; aspect-preserving width |
| `app/components/mosaic/v2/engine/rows.ts` | Greedy lat-descending, width-limited row formation |
| `app/components/mosaic/v2/engine/verticalPlace.ts` | `lerp(yPacked, yAnchor, geographicFidelity)` + relax pass |
| `app/components/mosaic/v2/engine/horizontalPlace.ts` | `solarAltitude` anchoring and `order` packing + `rowAlign` |
| `app/components/mosaic/v2/engine/bands.ts` | The `latitudeBands` alternative strategy |
| `app/components/mosaic/v2/engine/overflow.ts` | Uniform scale-down, hard scale floor, last-resort deterministic drop |
| `app/components/mosaic/v2/engine/compose.ts` | Orchestrator; owns the `showIfRoom` search |

**Created — React shell:**

| File | Responsibility |
|---|---|
| `app/components/mosaic/v2/useLoadedTiles.ts` | Image loading with the CORS-retry pattern; produces `TileInput[]` |
| `app/components/mosaic/v2/MosaicCanvas.tsx` | Canvas draw + click hit-testing |
| `app/components/mosaic/v2/overlays/FeedLabel.tsx` | `showFeedLabel` |
| `app/components/mosaic/v2/overlays/TileRatings.tsx` | `showTileRatings` |
| `app/components/mosaic/v2/overlays/ModelReadout.tsx` | `showModelReadout` |
| `app/components/mosaic/v2/overlays/SetupOverlay.tsx` | `setupMode` (fixed directive, carried from v1) |
| `app/components/mosaic/v2/settingsSchema.ts` | `V2_SETTINGS_SCHEMA` + `configFromSettings` |
| `app/components/mosaic/v2/index.tsx` | `MosaicV2` — merges settings, parses URL overrides, renders |

**Modified:**

| File | Change |
|---|---|
| `app/components/mosaic/types.ts` | Add optional `at?: string \| number` to `MosaicProps` |
| `app/components/mosaic/registry.ts` | Register `v2` in `MOSAIC_VERSIONS` and `MOSAIC_SETTINGS_SCHEMAS` |
| `app/studio/useSceneWebcams.ts` | Expose the selected scene's `representsAt` |
| `app/studio/PreviewPane.tsx` | Accept `at` and pass it to the mosaic |
| `app/studio/StudioClient.tsx` | Thread the scene moment into `PreviewPane` |

---

### Task 1: Contract change + v2 registration

Adds the `at` prop the solar math needs and registers a minimal real v2 so `?v=v2` and the studio version dropdown work from here on. `DEFAULT_MOSAIC_VERSION` stays `v1`, so nothing changes for the public site or the kiosk unless explicitly asked.

**Files:**
- Modify: `app/components/mosaic/types.ts`
- Create: `app/components/mosaic/v2/index.tsx`
- Create: `app/components/mosaic/v2/settingsSchema.ts`
- Modify: `app/components/mosaic/registry.ts`
- Test: `app/components/mosaic/v2/index.test.tsx`

**Interfaces:**
- Consumes: `MosaicProps` from `../types`, `SettingsSchema` from `@/app/lib/settings/schema`.
- Produces: `MosaicV2` (a `MosaicComponent`), `V2_SETTINGS_SCHEMA` (a `SettingsSchema`). Later tasks grow the schema and replace the placeholder body of `index.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/mosaic/v2/index.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV2 } from './index';
import { MOSAIC_VERSIONS, MOSAIC_SETTINGS_SCHEMAS, resolveMosaic } from '../registry';

describe('v2 registration', () => {
  it('is selectable by name from the registry', () => {
    expect(MOSAIC_VERSIONS.v2).toBe(MosaicV2);
    expect(resolveMosaic('v2')).toBe(MosaicV2);
  });

  it('exposes a settings schema under the v2 namespace', () => {
    expect(MOSAIC_SETTINGS_SCHEMAS.v2).toBeDefined();
    expect(Array.isArray(MOSAIC_SETTINGS_SCHEMAS.v2)).toBe(true);
  });

  it('renders a feed label at the given panel size', () => {
    render(<MosaicV2 webcams={[]} width={300} height={500} feed="sunset" />);
    expect(screen.getByText('SUNSET')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/index.test.tsx`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Add `at` to the contract**

In `app/components/mosaic/types.ts`, inside `interface MosaicProps`, after the `search` field:

```ts
  /**
   * The moment this composition represents, for solar-position math. Live
   * surfaces omit it (render time is correct); /studio passes the selected
   * scene's representsAt so a replayed scene computes the sun where it
   * actually was. Deliberately explicit: `lastUpdatedOn` cannot serve here —
   * it is `last_fetched_at` (Windy metadata) in the live payload but
   * `snapshot_captured_at` in reconstructed scenes.
   */
  at?: string | number;
```

- [ ] **Step 4: Create the placeholder schema**

```ts
// app/components/mosaic/v2/settingsSchema.ts
import type { SettingsSchema } from '@/app/lib/settings/schema';

/**
 * v2 composition knobs. Grows task by task; every knob here must have a
 * default equal to what the engine does with no settings present.
 */
export const V2_SETTINGS_SCHEMA: SettingsSchema = [] as const;
```

- [ ] **Step 5: Create the placeholder component**

```tsx
// app/components/mosaic/v2/index.tsx
'use client';

import type { MosaicProps } from '../types';

/**
 * v2 — latitude anchoring + depth-into-twilight arrangement. Built fresh;
 * v1 stays frozen as the reference. Body is filled in by later tasks.
 */
export function MosaicV2({ width, height, feed }: MosaicProps) {
  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0.3,
          color: '#fff',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        {feed === 'sunrise' ? 'SUNRISE' : 'SUNSET'}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Register v2**

In `app/components/mosaic/registry.ts`, add the import and both registry rows:

```ts
import { MosaicV2 } from './v2';
import { V2_SETTINGS_SCHEMA } from './v2/settingsSchema';
```

```ts
export const MOSAIC_VERSIONS: Record<string, MosaicComponent> = {
  v1: MosaicV1,
  v2: MosaicV2,
};
```

```ts
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
  v2: V2_SETTINGS_SCHEMA,
};
```

Leave `DEFAULT_MOSAIC_VERSION = 'v1'` unchanged.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- --run app/components/mosaic/v2/index.test.tsx app/components/mosaic/registry.test.tsx`
Expected: PASS. The existing `registry.test.tsx` must still pass — if it asserts an exact version list, update it to include `v2`.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/types.ts app/components/mosaic/registry.ts \
        app/components/mosaic/v2/index.tsx \
        app/components/mosaic/v2/settingsSchema.ts \
        app/components/mosaic/v2/index.test.tsx
git commit -m "feat(mosaic): register v2 and add optional \`at\` to MosaicProps"
```

---

### Task 2: Solar position helper

**Files:**
- Create: `app/components/mosaic/v2/solarPosition.ts`
- Test: `app/components/mosaic/v2/solarPosition.test.ts`

**Interfaces:**
- Consumes: `suncalc` (already in `package.json`, types via `@types/suncalc`).
- Produces: `sunAltitudeDeg(at: Date, lat: number, lng: number): number` — degrees, negative below the horizon. `TERMINATOR_ALTITUDE_DEG = -13`.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/solarPosition.test.ts
import { describe, it, expect } from 'vitest';
import { sunAltitudeDeg, TERMINATOR_ALTITUDE_DEG } from './solarPosition';

describe('sunAltitudeDeg', () => {
  it('is high near local solar noon at the equator on an equinox', () => {
    // 2026-03-20 12:00 UTC at 0N 0E — sun almost overhead.
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(alt).toBeGreaterThan(80);
  });

  it('is deeply negative on the opposite side of the globe at the same instant', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 180);
    expect(alt).toBeLessThan(-80);
  });

  it('is near the horizon a quarter turn away', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, -90);
    expect(Math.abs(alt)).toBeLessThan(5);
  });

  it('returns degrees, not radians', () => {
    const alt = sunAltitudeDeg(new Date('2026-03-20T12:00:00Z'), 0, 0);
    expect(Math.abs(alt)).toBeGreaterThan(Math.PI);
  });

  it('pins the terminator constant to the value masterConfig uses', () => {
    expect(TERMINATOR_ALTITUDE_DEG).toBe(-13);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/solarPosition.test.ts`
Expected: FAIL — cannot resolve `./solarPosition`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/solarPosition.ts
import SunCalc from 'suncalc';

/**
 * The altitude the terminator band is centred on. Mirrors
 * masterConfig.TERMINATOR_SUN_ALTITUDE_DEG, which is what the camera-finding
 * cron actually searches around — the pool IS a band of solar altitudes, and
 * that is why altitude works as v2's horizontal axis.
 */
export const TERMINATOR_ALTITUDE_DEG = -13;

const DEG_PER_RAD = 180 / Math.PI;

/**
 * The sun's altitude above the horizon at a place and moment, in degrees.
 * Negative below the horizon. This is v2's "depth into twilight" signal:
 * measured corr(lat, altitude) is ~0.06 on a real pool, so it carries
 * information the latitude axis does not.
 */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/solarPosition.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/solarPosition.ts app/components/mosaic/v2/solarPosition.test.ts
git commit -m "feat(mosaic/v2): solar altitude helper for the twilight-depth axis"
```

---

### Task 3: Quality signal

The single place v2 decides what a frame is worth. It returns pass and score as **two separate values** — collapsing them into one number is v1's named bug.

**Files:**
- Create: `app/components/mosaic/v2/qualitySignal.ts`
- Test: `app/components/mosaic/v2/qualitySignal.test.ts`

**Interfaces:**
- Consumes: `WindyWebcam` from `@/app/lib/types`.
- Produces:
  - `type QualitySource = 'auto' | 'model' | 'llm'`
  - `interface Signal { passes: boolean; score: number | null }`
  - `readSignal(w: WindyWebcam, source: QualitySource, gateThreshold: number): Signal`
  - `ratingGateFor(gateThreshold: number): number` — the 1–5 scale equivalent

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/qualitySignal.test.ts
import { describe, it, expect } from 'vitest';
import { readSignal, ratingGateFor } from './qualitySignal';
import type { WindyWebcam } from '@/app/lib/types';

const cam = (over: Partial<WindyWebcam>): WindyWebcam =>
  ({
    webcamId: 1,
    title: 't',
    viewCount: 0,
    status: 'active',
    location: { city: '', region: '', latitude: 0, longitude: 0, country: '', continent: '' },
    categories: [],
    ...over,
  }) as WindyWebcam;

describe('ratingGateFor', () => {
  it('converts a [0,1] probability to the stored 1-5 scale', () => {
    expect(ratingGateFor(0.55)).toBeCloseTo(3.2);
    expect(ratingGateFor(0)).toBe(1);
    expect(ratingGateFor(1)).toBe(5);
  });
});

describe('readSignal — model source', () => {
  it('passes when the detection rating clears the converted gate', () => {
    const s = readSignal(cam({ aiRatingBinary: 3.5, aiRatingRegression: 4 }), 'model', 0.55);
    expect(s.passes).toBe(true);
  });

  it('fails when the detection rating is below the converted gate', () => {
    const s = readSignal(cam({ aiRatingBinary: 3.0, aiRatingRegression: 4 }), 'model', 0.55);
    expect(s.passes).toBe(false);
  });

  it('does NOT treat the raw threshold as a 1-5 rating', () => {
    // 0.55 must mean rating 3.2, never rating 0.55. A cam at 1.0 (the very
    // bottom of the scale) must fail — under the bug it would pass.
    expect(readSignal(cam({ aiRatingBinary: 1.0 }), 'model', 0.55).passes).toBe(false);
  });

  it('normalizes the regression rating to [0,1]', () => {
    expect(readSignal(cam({ aiRatingRegression: 5 }), 'model', 0.55).score).toBe(1);
    expect(readSignal(cam({ aiRatingRegression: 1 }), 'model', 0.55).score).toBe(0);
    expect(readSignal(cam({ aiRatingRegression: 3 }), 'model', 0.55).score).toBe(0.5);
  });

  it('scores null when there is no regression rating', () => {
    expect(readSignal(cam({ aiRatingBinary: 4 }), 'model', 0.55).score).toBeNull();
  });
});

describe('readSignal — llm source', () => {
  it('gates on the boolean verdict, ignoring gateThreshold', () => {
    expect(readSignal(cam({ llmIsSunset: true, llmQuality: 0.1 }), 'llm', 0.99).passes).toBe(true);
    expect(readSignal(cam({ llmIsSunset: false, llmQuality: 0.9 }), 'llm', 0.01).passes).toBe(false);
  });

  it('uses llmQuality directly as the [0,1] score', () => {
    expect(readSignal(cam({ llmIsSunset: true, llmQuality: 0.72 }), 'llm', 0.55).score).toBe(0.72);
  });
});

describe('readSignal — auto source', () => {
  it('prefers the ML heads when present', () => {
    const s = readSignal(
      cam({ aiRatingBinary: 4, aiRatingRegression: 5, llmIsSunset: false, llmQuality: 0 }),
      'auto',
      0.55
    );
    expect(s).toEqual({ passes: true, score: 1 });
  });

  it('falls back to Claude when no ML score exists', () => {
    // Reconstructed historical scenes carry ONLY llm_* — without this the
    // seed scenes render as a uniform floor carpet and cannot be judged.
    const s = readSignal(cam({ llmIsSunset: true, llmQuality: 0.65 }), 'auto', 0.55);
    expect(s).toEqual({ passes: true, score: 0.65 });
  });

  it('is unscored and not-a-passer when neither judge has spoken', () => {
    expect(readSignal(cam({}), 'auto', 0.55)).toEqual({ passes: false, score: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/qualitySignal.test.ts`
Expected: FAIL — cannot resolve `./qualitySignal`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/qualitySignal.ts
import type { WindyWebcam } from '@/app/lib/types';

export type QualitySource = 'auto' | 'model' | 'llm';

/**
 * Pass verdict and size score, kept SEPARATE. v1 composed them into one
 * number, which floored the whole pool on a normal night and made ties
 * unsortable. `score` is always normalized to [0,1]; null means unscored.
 */
export interface Signal {
  passes: boolean;
  score: number | null;
}

/**
 * A [0,1] probability expressed on the 1-5 scale the aiRating* columns
 * store (`rating = 1 + probability * 4`). The knob is a probability; the
 * data is a rating. Confusing the two is the 35k-rows-zero-positives bug.
 */
export function ratingGateFor(gateThreshold: number): number {
  return 1 + gateThreshold * 4;
}

const normalizeRating = (rating: number): number => (rating - 1) / 4;

const hasModelSignal = (w: WindyWebcam): boolean =>
  typeof w.aiRatingBinary === 'number' || typeof w.aiRatingRegression === 'number';

const hasLlmSignal = (w: WindyWebcam): boolean =>
  typeof w.llmQuality === 'number' || typeof w.llmIsSunset === 'boolean';

function modelSignal(w: WindyWebcam, gateThreshold: number): Signal {
  const gate = ratingGateFor(gateThreshold);
  return {
    passes: typeof w.aiRatingBinary === 'number' && w.aiRatingBinary >= gate,
    score:
      typeof w.aiRatingRegression === 'number'
        ? normalizeRating(w.aiRatingRegression)
        : null,
  };
}

function llmSignal(w: WindyWebcam): Signal {
  // Claude's verdict is already a boolean, so gateThreshold has nothing to
  // act on here — the dial only means something for the model source.
  return {
    passes: w.llmIsSunset === true,
    score: typeof w.llmQuality === 'number' ? w.llmQuality : null,
  };
}

/**
 * THE v2 quality signal. `auto` exists because the two scene kinds carry
 * different judges: reconstructed historical scenes have only llm_*, the
 * live capture has only the ML heads. Without the fallback the seed scenes
 * render as a uniform floor carpet.
 */
export function readSignal(
  w: WindyWebcam,
  source: QualitySource,
  gateThreshold: number
): Signal {
  if (source === 'model') return modelSignal(w, gateThreshold);
  if (source === 'llm') return llmSignal(w);
  if (hasModelSignal(w)) return modelSignal(w, gateThreshold);
  if (hasLlmSignal(w)) return llmSignal(w);
  return { passes: false, score: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/qualitySignal.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/qualitySignal.ts app/components/mosaic/v2/qualitySignal.test.ts
git commit -m "feat(mosaic/v2): quality signal with separate gate and score"
```

---

### Task 4: Engine types + visibility

**Files:**
- Create: `app/components/mosaic/v2/engine/types.ts`
- Create: `app/components/mosaic/v2/engine/visibility.ts`
- Test: `app/components/mosaic/v2/engine/visibility.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (types are self-contained).
- Produces: the type vocabulary every later engine task uses, plus
  - `splitPool(tiles: TileInput[]): { passers: TileInput[]; failers: TileInput[] }` — each sorted by score descending, nulls last, `id` ascending as the tie-break so output is deterministic.
  - `applyPolicy(passers: TileInput[], failers: TileInput[], cfg: V2Config): TileInput[]`
  - `capTiles(tiles: TileInput[], maxTiles: number): TileInput[]`

- [ ] **Step 1: Write the engine types**

```ts
// app/components/mosaic/v2/engine/types.ts

/** One loadable frame, with everything the engine needs and nothing else. */
export interface TileInput {
  id: number; // webcamId
  lat: number;
  lng: number;
  srcWidth: number; // natural px of the loaded preview
  srcHeight: number;
  passes: boolean; // gate verdict from readSignal
  score: number | null; // [0,1] quality from readSignal
  sunAltitudeDeg: number | null; // null when the moment is unknown
}

export interface SizedTile extends TileInput {
  width: number;
  height: number;
  pinnedToFloor: boolean; // true for every gate-failer — the fixed directive
}

export interface Row {
  tiles: SizedTile[];
  height: number; // tallest member
  meanLat: number;
}

export interface PlacedRow extends Row {
  centerY: number;
}

export interface PlacedTile extends SizedTile {
  x: number;
  y: number;
}

export interface Layout {
  tiles: PlacedTile[];
  dropped: number[]; // webcamIds removed, last resort only
  scale: number; // 1 = the composition fit without shrinking
  viewport: { width: number; height: number };
}

export type FailedCamPolicy = 'hide' | 'showAtFloor' | 'showIfRoom';
export type SizingCurve = 'linear' | 'easeIn' | 'percentileAmongPassers';
export type ArrangementStrategy = 'anchorRelax' | 'latitudeBands';
export type HorizontalAnchor = 'solarAltitude' | 'order';
export type RowAlign = 'center' | 'justify' | 'west';

/** Every v2 composition knob, resolved to concrete values. */
export interface V2Config {
  // signal
  qualitySource: 'auto' | 'model' | 'llm';
  // visibility
  gateThreshold: number; // [0,1] probability
  failedCamPolicy: FailedCamPolicy;
  maxTiles: number; // 0 = unlimited
  // sizing
  floorPx: number;
  ceilingPx: number;
  curve: SizingCurve;
  // arrangement
  strategy: ArrangementStrategy;
  bandCount: number;
  horizontalAnchor: HorizontalAnchor;
  rowAlign: RowAlign;
  geographicFidelity: number; // [0,1]
  tileGapPx: number;
  latNorth: number;
  latSouth: number;
  // overlays
  showFeedLabel: boolean;
  showTileRatings: boolean;
  showModelReadout: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// app/components/mosaic/v2/engine/visibility.test.ts
import { describe, it, expect } from 'vitest';
import { splitPool, applyPolicy, capTiles } from './visibility';
import type { TileInput, V2Config } from './types';

const tile = (id: number, passes: boolean, score: number | null): TileInput => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: -13,
});

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 480, curve: 'percentileAmongPassers',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 6, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

describe('splitPool', () => {
  it('separates passers from failers', () => {
    const { passers, failers } = splitPool([tile(1, true, 0.9), tile(2, false, 0.2)]);
    expect(passers.map((t) => t.id)).toEqual([1]);
    expect(failers.map((t) => t.id)).toEqual([2]);
  });

  it('orders each group by score descending', () => {
    const { passers } = splitPool([tile(1, true, 0.2), tile(2, true, 0.9), tile(3, true, 0.5)]);
    expect(passers.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('puts unscored tiles last and breaks ties by id for determinism', () => {
    const { failers } = splitPool([tile(3, false, null), tile(2, false, 0.4), tile(1, false, 0.4)]);
    expect(failers.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe('applyPolicy', () => {
  const { passers, failers } = splitPool([
    tile(1, true, 0.9), tile(2, false, 0.4), tile(3, false, 0.1),
  ]);

  it('hide drops every gate-failer', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'hide' })).map((t) => t.id))
      .toEqual([1]);
  });

  it('showAtFloor keeps everyone, passers first', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'showAtFloor' })).map((t) => t.id))
      .toEqual([1, 2, 3]);
  });

  it('showIfRoom defers to compose and keeps everyone at this stage', () => {
    expect(applyPolicy(passers, failers, cfg({ failedCamPolicy: 'showIfRoom' })).map((t) => t.id))
      .toEqual([1, 2, 3]);
  });
});

describe('capTiles', () => {
  it('0 means unlimited', () => {
    const tiles = [tile(1, true, 0.9), tile(2, false, 0.1)];
    expect(capTiles(tiles, 0)).toHaveLength(2);
  });

  it('truncates to the cap, keeping the front of the list', () => {
    const tiles = [tile(1, true, 0.9), tile(2, true, 0.5), tile(3, false, 0.1)];
    expect(capTiles(tiles, 2).map((t) => t.id)).toEqual([1, 2]);
  });

  it('is a no-op when the pool is already under the cap', () => {
    expect(capTiles([tile(1, true, 0.9)], 5)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/engine/visibility.test.ts`
Expected: FAIL — cannot resolve `./visibility`.

- [ ] **Step 4: Write the implementation**

```ts
// app/components/mosaic/v2/engine/visibility.ts
import type { TileInput, V2Config } from './types';

/**
 * Descending by score with unscored last, then ascending by id. The id
 * tie-break matters: without it, equal-scoring tiles would reorder between
 * ticks and the layout would churn for no reason.
 */
function byScoreDesc(a: TileInput, b: TileInput): number {
  const as = a.score, bs = b.score;
  if (as === null && bs === null) return a.id - b.id;
  if (as === null) return 1;
  if (bs === null) return -1;
  if (as !== bs) return bs - as;
  return a.id - b.id;
}

export function splitPool(tiles: TileInput[]): {
  passers: TileInput[];
  failers: TileInput[];
} {
  const passers = tiles.filter((t) => t.passes).sort(byScoreDesc);
  const failers = tiles.filter((t) => !t.passes).sort(byScoreDesc);
  return { passers, failers };
}

/**
 * Which tiles are candidates for arrangement. `showIfRoom` cannot be decided
 * here — it depends on how much space the composed layout has left — so it
 * behaves like showAtFloor at this stage and compose() trims it down.
 */
export function applyPolicy(
  passers: TileInput[],
  failers: TileInput[],
  cfg: V2Config
): TileInput[] {
  if (cfg.failedCamPolicy === 'hide') return [...passers];
  return [...passers, ...failers];
}

/** A hard ceiling on tile count. Passers lead the list, so they survive first. */
export function capTiles(tiles: TileInput[], maxTiles: number): TileInput[] {
  if (maxTiles <= 0) return tiles;
  return tiles.slice(0, maxTiles);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/engine/visibility.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/types.ts \
        app/components/mosaic/v2/engine/visibility.ts \
        app/components/mosaic/v2/engine/visibility.test.ts
git commit -m "feat(mosaic/v2): engine types and visibility policy"
```

---

### Task 5: Sizing

**Files:**
- Create: `app/components/mosaic/v2/engine/sizing.ts`
- Test: `app/components/mosaic/v2/engine/sizing.test.ts`

**Interfaces:**
- Consumes: `TileInput`, `SizedTile`, `V2Config` from `./types`.
- Produces: `sizeTiles(tiles: TileInput[], cfg: V2Config): SizedTile[]`, `curveValue(score: number, curve: SizingCurve, percentile: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/engine/sizing.test.ts
import { describe, it, expect } from 'vitest';
import { sizeTiles } from './sizing';
import type { TileInput, V2Config } from './types';

const tile = (id: number, passes: boolean, score: number | null): TileInput => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: -13,
});

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 6, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

describe('sizeTiles — the floor-pin directive', () => {
  it('pins every gate-failer to the EXACT floor, whatever its score', () => {
    const out = sizeTiles([tile(1, false, 0.9), tile(2, false, 0.1), tile(3, false, null)], cfg());
    expect(out.map((t) => t.height)).toEqual([100, 100, 100]);
    expect(out.every((t) => t.pinnedToFloor)).toBe(true);
  });

  it('never lets a failer creep above the floor even at ceiling-level scores', () => {
    const [t] = sizeTiles([tile(1, false, 1)], cfg({ floorPx: 120, ceilingPx: 900 }));
    expect(t.height).toBe(120);
  });

  it('marks passers as not pinned', () => {
    const [t] = sizeTiles([tile(1, true, 0.5)], cfg());
    expect(t.pinnedToFloor).toBe(false);
  });
});

describe('sizeTiles — curves', () => {
  it('linear maps score 0 to floor and 1 to ceiling', () => {
    const out = sizeTiles([tile(1, true, 0), tile(2, true, 1)], cfg({ curve: 'linear' }));
    expect(out[0].height).toBe(100);
    expect(out[1].height).toBe(500);
  });

  it('easeIn holds mid scores smaller than linear does', () => {
    const [lin] = sizeTiles([tile(1, true, 0.5)], cfg({ curve: 'linear' }));
    const [ease] = sizeTiles([tile(1, true, 0.5)], cfg({ curve: 'easeIn' }));
    expect(ease.height).toBeLessThan(lin.height);
    expect(ease.height).toBe(200); // 100 + 400 * 0.25
  });

  it('percentileAmongPassers ranks within the passers only', () => {
    // A failer at score 0.99 must not affect the passers' spread.
    const out = sizeTiles(
      [tile(1, true, 0.10), tile(2, true, 0.11), tile(3, false, 0.99)],
      cfg({ curve: 'percentileAmongPassers' })
    );
    const byId = new Map(out.map((t) => [t.id, t]));
    expect(byId.get(1)!.height).toBe(100); // lowest passer -> floor
    expect(byId.get(2)!.height).toBe(500); // highest passer -> ceiling
    expect(byId.get(3)!.height).toBe(100); // failer -> pinned floor
  });

  it('percentileAmongPassers gives a lone passer the ceiling', () => {
    const out = sizeTiles([tile(1, true, 0.3)], cfg({ curve: 'percentileAmongPassers' }));
    expect(out[0].height).toBe(500);
  });

  it('percentileAmongPassers gives tied passers an identical height', () => {
    const out = sizeTiles(
      [tile(1, true, 0.4), tile(2, true, 0.4), tile(3, true, 0.4)],
      cfg({ curve: 'percentileAmongPassers' })
    );
    expect(out[0].height).toBe(out[1].height);
    expect(out[1].height).toBe(out[2].height);
  });

  it('treats a scored-null passer as floor rather than crashing', () => {
    const out = sizeTiles([tile(1, true, null)], cfg({ curve: 'linear' }));
    expect(out[0].height).toBe(100);
  });
});

describe('sizeTiles — geometry', () => {
  it('preserves the source aspect ratio', () => {
    const out = sizeTiles([tile(1, true, 1)], cfg());
    expect(out[0].width / out[0].height).toBeCloseTo(400 / 300);
  });

  it('has no upscale clamp — the floor is exact', () => {
    // A tiny source must still render at the floor, not below it.
    const tiny: TileInput = { ...tile(1, false, null), srcWidth: 8, srcHeight: 6 };
    expect(sizeTiles([tiny], cfg())[0].height).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/engine/sizing.test.ts`
Expected: FAIL — cannot resolve `./sizing`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/engine/sizing.ts
import type { SizedTile, TileInput, V2Config } from './types';

/**
 * Percentile of each passer within the passers alone, ties sharing the mean
 * of their ranks. Scoped to passers on purpose: v1 ranked across the whole
 * pool, so on a normal night the handful of real sunsets were dragged into
 * the middle of a distribution made almost entirely of floored night frames.
 */
function percentilesAmongPassers(passers: TileInput[]): Map<number, number> {
  const out = new Map<number, number>();
  const scored = passers.filter(
    (t): t is TileInput & { score: number } => t.score !== null
  );
  const n = scored.length;
  if (n === 1) {
    out.set(scored[0].id, 1);
    return out;
  }
  const sorted = [...scored].sort((a, b) => a.score - b.score);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sorted[j].score === sorted[i].score) j++;
    let sum = 0;
    for (let k = i; k < j; k++) sum += k / (n - 1);
    const mean = sum / (j - i);
    for (let k = i; k < j; k++) out.set(sorted[k].id, mean);
    i = j;
  }
  return out;
}

/**
 * Sizes every tile by height, then derives width from the source aspect
 * ratio. Two rules are fixed directives, not knobs:
 *   - gate-failers pin to the EXACT floor, never spreading across the curve
 *   - there is no upscale clamp (v1's upscaleMax), because a clamp would
 *     silently push small sources below the floor
 */
export function sizeTiles(tiles: TileInput[], cfg: V2Config): SizedTile[] {
  const span = cfg.ceilingPx - cfg.floorPx;
  const percentiles =
    cfg.curve === 'percentileAmongPassers'
      ? percentilesAmongPassers(tiles.filter((t) => t.passes))
      : null;

  return tiles.map((t) => {
    let height = cfg.floorPx;
    if (t.passes && t.score !== null) {
      let unit: number;
      if (percentiles) unit = percentiles.get(t.id) ?? 0;
      else if (cfg.curve === 'easeIn') unit = t.score * t.score;
      else unit = t.score;
      height = cfg.floorPx + span * unit;
    }
    const aspect = t.srcHeight > 0 ? t.srcWidth / t.srcHeight : 4 / 3;
    return { ...t, height, width: height * aspect, pinnedToFloor: !t.passes };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/engine/sizing.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/sizing.ts app/components/mosaic/v2/engine/sizing.test.ts
git commit -m "feat(mosaic/v2): sizing curves with exact floor pinning for gate-failers"
```

---

### Task 6: Row formation + vertical placement

The `geographicFidelity` lerp — the heart of the composition.

**Files:**
- Create: `app/components/mosaic/v2/engine/rows.ts`
- Create: `app/components/mosaic/v2/engine/verticalPlace.ts`
- Test: `app/components/mosaic/v2/engine/rows.test.ts`
- Test: `app/components/mosaic/v2/engine/verticalPlace.test.ts`

**Interfaces:**
- Consumes: `SizedTile`, `Row`, `PlacedRow`, `V2Config` from `./types`.
- Produces:
  - `formRows(tiles: SizedTile[], viewportWidth: number, gap: number): Row[]`
  - `mapLatToY(lat: number, cfg: V2Config, viewportHeight: number): number`
  - `placeRowsVertically(rows: Row[], viewportHeight: number, cfg: V2Config): { rows: PlacedRow[]; extent: number }` — `extent` is the unclamped top-to-bottom height, which is what the overflow stage scales against.

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/mosaic/v2/engine/rows.test.ts
import { describe, it, expect } from 'vitest';
import { formRows } from './rows';
import type { SizedTile } from './types';

const sized = (id: number, lat: number, w: number, h = 100): SizedTile => ({
  id, lat, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: h, pinnedToFloor: false,
});

describe('formRows', () => {
  it('walks north to south', () => {
    const rows = formRows([sized(1, -40, 100), sized(2, 60, 100), sized(3, 10, 100)], 200, 0);
    expect(rows[0].tiles[0].id).toBe(2);
    expect(rows[rows.length - 1].tiles.at(-1)!.id).toBe(1);
  });

  it('breaks a row when the next tile would overflow the width', () => {
    const rows = formRows([sized(1, 50, 120), sized(2, 40, 120)], 200, 0);
    expect(rows).toHaveLength(2);
  });

  it('counts the gap toward the width budget', () => {
    // 2x95 = 190 fits in 200 on its own. With a 10px gap it exactly fills the
    // 200px budget and still fits; a 20px gap pushes it to 210 and it must wrap.
    expect(formRows([sized(1, 50, 95), sized(2, 40, 95)], 200, 10)).toHaveLength(1);
    expect(formRows([sized(1, 50, 95), sized(2, 40, 95)], 200, 20)).toHaveLength(2);
  });

  it('always places an over-wide tile rather than looping forever', () => {
    const rows = formRows([sized(1, 50, 5000)], 200, 6);
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles[0].id).toBe(1);
  });

  it('reports the row height as its tallest member', () => {
    const rows = formRows([sized(1, 50, 50, 100), sized(2, 40, 50, 250)], 500, 0);
    expect(rows[0].height).toBe(250);
  });

  it('reports the mean latitude of its members', () => {
    const rows = formRows([sized(1, 60, 50), sized(2, 40, 50)], 500, 0);
    expect(rows[0].meanLat).toBe(50);
  });

  it('returns no rows for an empty pool', () => {
    expect(formRows([], 500, 6)).toEqual([]);
  });
});
```

```ts
// app/components/mosaic/v2/engine/verticalPlace.test.ts
import { describe, it, expect } from 'vitest';
import { mapLatToY, placeRowsVertically } from './verticalPlace';
import type { Row, SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 1, tileGapPx: 0, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number): SizedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: 100, height: 100, pinnedToFloor: false,
});

const row = (meanLat: number, height = 100): Row => ({
  tiles: [tile(Math.round(meanLat) + 1000)], height, meanLat,
});

describe('mapLatToY', () => {
  it('puts the north edge of the window at the top', () => {
    expect(mapLatToY(70, cfg(), 1000)).toBe(0);
  });

  it('puts the south edge at the bottom', () => {
    expect(mapLatToY(-60, cfg(), 1000)).toBe(1000);
  });

  it('is linear in between', () => {
    expect(mapLatToY(5, cfg(), 1300)).toBe(650);
  });

  it('clamps latitudes outside the window', () => {
    expect(mapLatToY(89, cfg(), 1000)).toBe(0);
    expect(mapLatToY(-89, cfg(), 1000)).toBe(1000);
  });
});

describe('placeRowsVertically — fidelity 1 (true latitude)', () => {
  it('anchors a lone row at its own latitude, not the middle', () => {
    const { rows } = placeRowsVertically([row(70)], 1000, cfg({ geographicFidelity: 1 }));
    expect(rows[0].centerY).toBe(0);
  });

  it('leaves a real gap between distant latitudes', () => {
    const { rows } = placeRowsVertically(
      [row(70), row(-60)], 1000, cfg({ geographicFidelity: 1 })
    );
    expect(rows[1].centerY - rows[0].centerY).toBeGreaterThan(900);
  });
});

describe('placeRowsVertically — fidelity 0 (dense packing)', () => {
  it('stacks rows contiguously and centres the block', () => {
    const { rows } = placeRowsVertically(
      [row(70), row(-60)], 1000, cfg({ geographicFidelity: 0, tileGapPx: 0 })
    );
    expect(rows[1].centerY - rows[0].centerY).toBe(100);
    // block of 200 in a 1000 viewport -> starts at 400, centres at 450 and 550
    expect(rows[0].centerY).toBe(450);
  });
});

describe('placeRowsVertically — the relax pass', () => {
  it('pushes an overlapping row down rather than letting it collide', () => {
    const { rows } = placeRowsVertically(
      [row(10), row(9)], 1000, cfg({ geographicFidelity: 1, tileGapPx: 10 })
    );
    const gap = rows[1].centerY - rows[0].centerY;
    expect(gap).toBeGreaterThanOrEqual(110); // half+half height + gap
  });

  it('never reorders rows — north stays above south', () => {
    const { rows } = placeRowsVertically(
      [row(60), row(30), row(-30)], 1000, cfg({ geographicFidelity: 1 })
    );
    expect(rows[0].meanLat).toBe(60);
    expect(rows[2].meanLat).toBe(-30);
  });

  it('reports an extent larger than the viewport when it cannot fit', () => {
    const many = Array.from({ length: 20 }, (_, i) => row(60 - i * 6, 100));
    const { extent } = placeRowsVertically(many, 500, cfg({ geographicFidelity: 0 }));
    expect(extent).toBeGreaterThan(500);
  });

  it('handles an empty row list', () => {
    expect(placeRowsVertically([], 1000, cfg())).toEqual({ rows: [], extent: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run app/components/mosaic/v2/engine/rows.test.ts app/components/mosaic/v2/engine/verticalPlace.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement row formation**

```ts
// app/components/mosaic/v2/engine/rows.ts
import type { Row, SizedTile } from './types';

/**
 * Greedy north-to-south row formation, width-limited. Row membership is by
 * ORDER, not by latitude bucket — two tiles at nearly the same latitude may
 * land in different rows if the first one filled up, which is correct: the
 * vertical stage puts each row at its own mean latitude anyway.
 */
export function formRows(
  tiles: SizedTile[],
  viewportWidth: number,
  gap: number
): Row[] {
  if (tiles.length === 0) return [];

  const northToSouth = [...tiles].sort((a, b) => b.lat - a.lat || a.id - b.id);
  const groups: SizedTile[][] = [];
  let current: SizedTile[] = [];
  let usedWidth = 0;

  for (const tile of northToSouth) {
    const addedWidth = current.length === 0 ? tile.width : gap + tile.width;
    // `current.length > 0` guarantees a single over-wide tile still lands
    // somewhere instead of spinning on an empty row forever.
    if (current.length > 0 && usedWidth + addedWidth > viewportWidth) {
      groups.push(current);
      current = [];
      usedWidth = 0;
    }
    usedWidth += current.length === 0 ? tile.width : gap + tile.width;
    current.push(tile);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((members) => ({
    tiles: members,
    height: Math.max(...members.map((t) => t.height)),
    meanLat: members.reduce((sum, t) => sum + t.lat, 0) / members.length,
  }));
}
```

- [ ] **Step 4: Implement vertical placement**

```ts
// app/components/mosaic/v2/engine/verticalPlace.ts
import type { PlacedRow, Row, V2Config } from './types';

/** Latitude to a y centre, north at the top, clamped to the configured window. */
export function mapLatToY(
  lat: number,
  cfg: V2Config,
  viewportHeight: number
): number {
  const span = cfg.latNorth - cfg.latSouth;
  if (span <= 0) return viewportHeight / 2;
  const t = (cfg.latNorth - lat) / span;
  return Math.max(0, Math.min(1, t)) * viewportHeight;
}

/**
 * Each row gets two candidate centres — its true latitude (yAnchor) and its
 * position in a contiguous, vertically centred stack (yPacked) — and
 * geographicFidelity interpolates between them. 1 keeps gaps as gaps, so an
 * ocean under the terminator reads as emptiness; 0 packs densely and leaves
 * geography as ordering only.
 *
 * A relax pass then pushes any overlapping row down. Order is preserved and
 * y only ever increases, so north never falls below south. `extent` is the
 * unclamped height, which is what the overflow stage scales against.
 */
export function placeRowsVertically(
  rows: Row[],
  viewportHeight: number,
  cfg: V2Config
): { rows: PlacedRow[]; extent: number } {
  if (rows.length === 0) return { rows: [], extent: 0 };

  const gap = cfg.tileGapPx;
  const stackHeight =
    rows.reduce((sum, r) => sum + r.height, 0) + gap * (rows.length - 1);

  let packedTop = Math.max(0, (viewportHeight - stackHeight) / 2);
  const fidelity = Math.max(0, Math.min(1, cfg.geographicFidelity));

  const placed: PlacedRow[] = rows.map((r) => {
    const packedCenter = packedTop + r.height / 2;
    packedTop += r.height + gap;
    const anchorCenter = mapLatToY(r.meanLat, cfg, viewportHeight);
    return { ...r, centerY: packedCenter + (anchorCenter - packedCenter) * fidelity };
  });

  // Relax downward. Input is already north-to-south, so index order is the
  // order we must keep — do NOT sort by centerY here.
  for (let i = 1; i < placed.length; i++) {
    const minCenter =
      placed[i - 1].centerY + placed[i - 1].height / 2 + gap + placed[i].height / 2;
    if (placed[i].centerY < minCenter) placed[i].centerY = minCenter;
  }

  const top = placed[0].centerY - placed[0].height / 2;
  const last = placed[placed.length - 1];
  const bottom = last.centerY + last.height / 2;

  // Pull the whole block up into any slack above before declaring overflow.
  if (bottom > viewportHeight && top > 0) {
    const shift = Math.min(top, bottom - viewportHeight);
    for (const r of placed) r.centerY -= shift;
  }

  return { rows: placed, extent: bottom - top };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --run app/components/mosaic/v2/engine/rows.test.ts app/components/mosaic/v2/engine/verticalPlace.test.ts`
Expected: PASS (7 + 11 tests).

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/rows.ts \
        app/components/mosaic/v2/engine/rows.test.ts \
        app/components/mosaic/v2/engine/verticalPlace.ts \
        app/components/mosaic/v2/engine/verticalPlace.test.ts
git commit -m "feat(mosaic/v2): row formation and geographicFidelity vertical placement"
```

---

### Task 7: Horizontal placement

Where `solarAltitude` — the decision this whole design turns on — becomes real.

**Files:**
- Create: `app/components/mosaic/v2/engine/horizontalPlace.ts`
- Test: `app/components/mosaic/v2/engine/horizontalPlace.test.ts`

**Interfaces:**
- Consumes: `PlacedRow`, `PlacedTile`, `V2Config`, `RowAlign` from `./types`.
- Produces:
  - `altitudeToUnit(altDeg: number, min: number, max: number, feed: 'sunrise' | 'sunset'): number` — 0 = west edge, 1 = east edge.
  - `altitudeRange(tiles: { sunAltitudeDeg: number | null }[]): { min: number; max: number } | null`
  - `placeRowHorizontally(row: PlacedRow, viewportWidth: number, cfg: V2Config, feed: 'sunrise' | 'sunset', altRange: { min: number; max: number } | null): PlacedTile[]`

**Direction rule (important):** the fixed directive is west→east renders left→right. The sun sets in the west, so on the **sunset** feed a camera further east is later in the day and its sun is *lower* — west→east means altitude high→low. On the **sunrise** feed it is the reverse. `altitudeToUnit` encodes this so both feeds obey the directive.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/engine/horizontalPlace.test.ts
import { describe, it, expect } from 'vitest';
import { altitudeToUnit, altitudeRange, placeRowHorizontally } from './horizontalPlace';
import type { PlacedRow, SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'order',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 10, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number, lng: number, alt: number | null, w = 100): SizedTile => ({
  id, lat: 0, lng, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: alt,
  width: w, height: 100, pinnedToFloor: false,
});

const row = (tiles: SizedTile[]): PlacedRow => ({
  tiles, height: 100, meanLat: 0, centerY: 500,
});

describe('altitudeToUnit — direction per feed', () => {
  it('sunset: a HIGHER sun is further west, so it goes left', () => {
    expect(altitudeToUnit(-5, -20, -5, 'sunset')).toBe(0);
    expect(altitudeToUnit(-20, -20, -5, 'sunset')).toBe(1);
  });

  it('sunrise: a higher sun is further east, so it goes right', () => {
    expect(altitudeToUnit(-5, -20, -5, 'sunrise')).toBe(1);
    expect(altitudeToUnit(-20, -20, -5, 'sunrise')).toBe(0);
  });

  it('centres everything when the band has no spread', () => {
    expect(altitudeToUnit(-13, -13, -13, 'sunset')).toBe(0.5);
  });
});

describe('altitudeRange', () => {
  it('spans the pool, ignoring nulls', () => {
    expect(altitudeRange([{ sunAltitudeDeg: -5 }, { sunAltitudeDeg: null }, { sunAltitudeDeg: -20 }]))
      .toEqual({ min: -20, max: -5 });
  });

  it('is null when nothing has an altitude', () => {
    expect(altitudeRange([{ sunAltitudeDeg: null }])).toBeNull();
  });
});

describe('placeRowHorizontally — order anchoring', () => {
  it('renders west to east, left to right', () => {
    const out = placeRowHorizontally(
      row([tile(2, 40, null), tile(1, -70, null)]), 1000, cfg({ horizontalAnchor: 'order' }), 'sunset', null
    );
    expect(out.map((t) => t.id)).toEqual([1, 2]);
    expect(out[0].x).toBeLessThan(out[1].x);
  });

  it('centres the row by default', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'center' }), 'sunset', null
    );
    // two 100px tiles + 10px gap = 210 wide, centred in 1000 -> starts at 395
    expect(out[0].x).toBe(395);
  });

  it('west alignment pins the row to the left edge', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'west' }), 'sunset', null
    );
    expect(out[0].x).toBe(0);
  });

  it('justify spreads the row edge to edge', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null), tile(2, 10, null)]), 1000, cfg({ rowAlign: 'justify' }), 'sunset', null
    );
    expect(out[0].x).toBe(0);
    expect(out[1].x + out[1].width).toBe(1000);
  });

  it('justify falls back to centring a single-tile row', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, null)]), 1000, cfg({ rowAlign: 'justify' }), 'sunset', null
    );
    expect(out[0].x).toBe(450);
  });
});

describe('placeRowHorizontally — solarAltitude anchoring', () => {
  const altCfg = cfg({ horizontalAnchor: 'solarAltitude' });
  const range = { min: -20, max: -5 };

  it('places a west-most (highest sun) tile at the left edge on the sunset feed', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -5)]), 1000, altCfg, 'sunset', range);
    expect(out[0].x).toBe(0);
  });

  it('places an east-most (lowest sun) tile at the right edge on the sunset feed', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -20)]), 1000, altCfg, 'sunset', range);
    expect(out[0].x).toBe(900); // 1000 - width
  });

  it('separates tiles that are genuinely far apart in twilight depth', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -5), tile(2, 0, -20)]), 1000, altCfg, 'sunset', range
    );
    expect(out[1].x - out[0].x).toBeGreaterThan(500);
  });

  it('de-overlaps neighbours that anchor to nearly the same altitude', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -12.9), tile(2, 0, -13.0), tile(3, 0, -13.1)]),
      1000, altCfg, 'sunset', range
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x + out[i - 1].width + altCfg.tileGapPx - 0.001);
    }
  });

  it('keeps every tile inside the panel', () => {
    const out = placeRowHorizontally(
      row([tile(1, 0, -19.9), tile(2, 0, -20), tile(3, 0, -19.8)]),
      500, altCfg, 'sunset', range
    );
    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(500.001);
    }
  });

  it('falls back to order packing when no altitude is known', () => {
    const out = placeRowHorizontally(
      row([tile(2, 40, null), tile(1, -70, null)]), 1000, altCfg, 'sunset', null
    );
    expect(out.map((t) => t.id)).toEqual([1, 2]);
  });

  it('gives every tile the row centre as its vertical position', () => {
    const out = placeRowHorizontally(row([tile(1, 0, -13, 100)]), 1000, altCfg, 'sunset', range);
    expect(out[0].y).toBe(450); // centreY 500 - height/2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/engine/horizontalPlace.test.ts`
Expected: FAIL — cannot resolve `./horizontalPlace`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/engine/horizontalPlace.ts
import type { PlacedRow, PlacedTile, SizedTile, V2Config } from './types';

/**
 * Solar altitude to a horizontal unit position, 0 = west edge, 1 = east.
 *
 * The sun sets in the west, so on the SUNSET feed a camera further east is
 * later in the day and its sun sits LOWER — west-to-east is altitude
 * high-to-low, and the mapping inverts. Sunrise is the mirror. This keeps
 * the spec's "west to east renders left to right" directive true on both
 * feeds while X still means depth into twilight.
 */
export function altitudeToUnit(
  altDeg: number,
  min: number,
  max: number,
  feed: 'sunrise' | 'sunset'
): number {
  const span = max - min;
  if (span <= 0) return 0.5;
  const unit = (altDeg - min) / span;
  return feed === 'sunrise' ? unit : 1 - unit;
}

export function altitudeRange(
  tiles: { sunAltitudeDeg: number | null }[]
): { min: number; max: number } | null {
  const known = tiles
    .map((t) => t.sunAltitudeDeg)
    .filter((a): a is number => a !== null && Number.isFinite(a));
  if (known.length === 0) return null;
  return { min: Math.min(...known), max: Math.max(...known) };
}

/** Shoulder-to-shoulder packing in west-to-east order, honouring rowAlign. */
function packByOrder(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config
): PlacedTile[] {
  const tiles = [...row.tiles].sort((a, b) => a.lng - b.lng || a.id - b.id);
  const tilesWidth = tiles.reduce((sum, t) => sum + t.width, 0);
  const total = tilesWidth + cfg.tileGapPx * (tiles.length - 1);

  let gap = cfg.tileGapPx;
  let x = 0;
  if (cfg.rowAlign === 'justify' && tiles.length > 1) {
    gap = (viewportWidth - tilesWidth) / (tiles.length - 1);
  } else if (cfg.rowAlign !== 'west') {
    x = (viewportWidth - total) / 2; // 'center', and 'justify' with one tile
  }

  const y = row.centerY - row.height / 2;
  return tiles.map((t) => {
    const placed: PlacedTile = { ...t, x, y: y + (row.height - t.height) / 2 };
    x += t.width + gap;
    return placed;
  });
}

/** Anchor each tile to its twilight depth, then de-overlap left to right. */
function packByAltitude(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config,
  feed: 'sunrise' | 'sunset',
  altRange: { min: number; max: number }
): PlacedTile[] {
  const y = row.centerY - row.height / 2;
  const anchored = row.tiles
    .map((t) => {
      const unit =
        t.sunAltitudeDeg === null
          ? 0.5
          : altitudeToUnit(t.sunAltitudeDeg, altRange.min, altRange.max, feed);
      return { tile: t, x: unit * Math.max(0, viewportWidth - t.width) };
    })
    .sort((a, b) => a.x - b.x || a.tile.id - b.tile.id);

  for (let i = 1; i < anchored.length; i++) {
    const minX = anchored[i - 1].x + anchored[i - 1].tile.width + cfg.tileGapPx;
    if (anchored[i].x < minX) anchored[i].x = minX;
  }

  // De-overlapping only pushes right, so the row can run off the edge —
  // slide the whole row back so the last tile lands on the panel edge.
  const last = anchored[anchored.length - 1];
  const overflow = last.x + last.tile.width - viewportWidth;
  if (overflow > 0) {
    for (const a of anchored) a.x = Math.max(0, a.x - overflow);
  }

  return anchored.map(({ tile, x }) => ({
    ...tile,
    x,
    y: y + (row.height - tile.height) / 2,
  }));
}

/**
 * Places one row's tiles horizontally. Vertical position comes from the row;
 * shorter tiles are centred within the row's height.
 */
export function placeRowHorizontally(
  row: PlacedRow,
  viewportWidth: number,
  cfg: V2Config,
  feed: 'sunrise' | 'sunset',
  altRange: { min: number; max: number } | null
): PlacedTile[] {
  if (row.tiles.length === 0) return [];
  if (cfg.horizontalAnchor === 'solarAltitude' && altRange !== null) {
    return packByAltitude(row, viewportWidth, cfg, feed, altRange);
  }
  return packByOrder(row, viewportWidth, cfg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/engine/horizontalPlace.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/horizontalPlace.ts \
        app/components/mosaic/v2/engine/horizontalPlace.test.ts
git commit -m "feat(mosaic/v2): twilight-depth horizontal anchoring with order fallback"
```

---

### Task 8: Latitude bands strategy

The A/B alternative to `anchorRelax`, so the zones-vs-continuous question is settled on the glass.

**Files:**
- Create: `app/components/mosaic/v2/engine/bands.ts`
- Test: `app/components/mosaic/v2/engine/bands.test.ts`

**Interfaces:**
- Consumes: `SizedTile`, `PlacedRow`, `V2Config` from `./types`; `formRows` from `./rows`.
- Produces: `placeBands(tiles: SizedTile[], viewport: { width: number; height: number }, cfg: V2Config): { rows: PlacedRow[]; extent: number }` — same return shape as `placeRowsVertically`, so `compose` can swap strategies with one branch.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/engine/bands.test.ts
import { describe, it, expect } from 'vitest';
import { placeBands } from './bands';
import type { SizedTile, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 500, curve: 'linear',
  strategy: 'latitudeBands', bandCount: 4, horizontalAnchor: 'order',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 0, latNorth: 80, latSouth: -80,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (id: number, lat: number, w = 100): SizedTile => ({
  id, lat, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: 100, pinnedToFloor: false,
});

describe('placeBands', () => {
  it('creates one row per occupied band, north to south', () => {
    // bands over [80,-80] at bandCount 4 are 40deg tall each
    const { rows } = placeBands([tile(1, 70), tile(2, -70)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
    expect(rows[0].centerY).toBeLessThan(rows[1].centerY);
  });

  it('groups tiles that share a band into one row', () => {
    const { rows } = placeBands(
      [tile(1, 75), tile(2, 45)], { width: 1000, height: 800 }, cfg()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(2);
  });

  it('skips empty bands rather than leaving blank rows', () => {
    const { rows } = placeBands([tile(1, 75)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(1);
  });

  it('centres each band row on its band', () => {
    // band 0 spans the top quarter of an 800px panel -> centre 100
    const { rows } = placeBands([tile(1, 75)], { width: 1000, height: 800 }, cfg());
    expect(rows[0].centerY).toBe(100);
  });

  it('splits a band into several rows when its tiles overflow the width', () => {
    const wide = [tile(1, 75, 600), tile(2, 74, 600)];
    const { rows } = placeBands(wide, { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
  });

  it('clamps out-of-window latitudes into the end bands', () => {
    const { rows } = placeBands([tile(1, 89), tile(2, -89)], { width: 1000, height: 800 }, cfg());
    expect(rows).toHaveLength(2);
  });

  it('reports an extent covering the placed rows', () => {
    const { extent } = placeBands([tile(1, 75), tile(2, -75)], { width: 1000, height: 800 }, cfg());
    expect(extent).toBeGreaterThan(0);
  });

  it('returns nothing for an empty pool', () => {
    expect(placeBands([], { width: 1000, height: 800 }, cfg())).toEqual({ rows: [], extent: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/engine/bands.test.ts`
Expected: FAIL — cannot resolve `./bands`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/engine/bands.ts
import { formRows } from './rows';
import type { PlacedRow, SizedTile, V2Config } from './types';

/**
 * The fixed-zone alternative to anchorRelax: chop the latitude window into
 * bandCount equal bands, drop every tile into its band, and centre each
 * band's row on the band. Empty bands stay empty rather than collapsing, so
 * a quiet latitude still reads as quiet — but unlike anchorRelax the
 * vertical positions are quantised.
 */
export function placeBands(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V2Config
): { rows: PlacedRow[]; extent: number } {
  if (tiles.length === 0) return { rows: [], extent: 0 };

  const bandCount = Math.max(1, Math.floor(cfg.bandCount));
  const span = cfg.latNorth - cfg.latSouth;
  const bandHeight = viewport.height / bandCount;

  const buckets = new Map<number, SizedTile[]>();
  for (const tile of tiles) {
    const t = span > 0 ? (cfg.latNorth - tile.lat) / span : 0.5;
    const index = Math.max(0, Math.min(bandCount - 1, Math.floor(t * bandCount)));
    const bucket = buckets.get(index);
    if (bucket) bucket.push(tile);
    else buckets.set(index, [tile]);
  }

  const rows: PlacedRow[] = [];
  for (const index of [...buckets.keys()].sort((a, b) => a - b)) {
    const bandCenter = (index + 0.5) * bandHeight;
    // A band wider than the panel still has to wrap, so reuse row formation
    // and stack the resulting rows around the band's centre.
    const formed = formRows(buckets.get(index)!, viewport.width, cfg.tileGapPx);
    const stackHeight =
      formed.reduce((sum, r) => sum + r.height, 0) + cfg.tileGapPx * (formed.length - 1);
    let top = bandCenter - stackHeight / 2;
    for (const row of formed) {
      rows.push({ ...row, centerY: top + row.height / 2 });
      top += row.height + cfg.tileGapPx;
    }
  }

  const top = Math.min(...rows.map((r) => r.centerY - r.height / 2));
  const bottom = Math.max(...rows.map((r) => r.centerY + r.height / 2));
  return { rows, extent: bottom - top };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/engine/bands.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/bands.ts app/components/mosaic/v2/engine/bands.test.ts
git commit -m "feat(mosaic/v2): latitudeBands arrangement strategy"
```

---

### Task 9: Overflow + compose orchestrator

**Files:**
- Create: `app/components/mosaic/v2/engine/overflow.ts`
- Create: `app/components/mosaic/v2/engine/compose.ts`
- Test: `app/components/mosaic/v2/engine/overflow.test.ts`
- Test: `app/components/mosaic/v2/engine/compose.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–8.
- Produces:
  - `MIN_COMPOSITION_SCALE = 0.35`
  - `scaleTiles(tiles: SizedTile[], k: number): SizedTile[]`
  - `compose(tiles: TileInput[], viewport: { width: number; height: number }, cfg: V2Config, feed: 'sunrise' | 'sunset'): Layout`

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/mosaic/v2/engine/overflow.test.ts
import { describe, it, expect } from 'vitest';
import { scaleTiles, MIN_COMPOSITION_SCALE } from './overflow';
import type { SizedTile } from './types';

const tile = (id: number, w: number, h: number): SizedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
  passes: true, score: 0.5, sunAltitudeDeg: -13,
  width: w, height: h, pinnedToFloor: false,
});

describe('scaleTiles', () => {
  it('scales width and height by the same factor', () => {
    const [t] = scaleTiles([tile(1, 200, 100)], 0.5);
    expect(t.width).toBe(100);
    expect(t.height).toBe(50);
  });

  it('preserves relative hierarchy — a big tile stays proportionally bigger', () => {
    const out = scaleTiles([tile(1, 100, 100), tile(2, 400, 400)], 0.5);
    expect(out[1].height / out[0].height).toBe(4);
  });

  it('is a no-op at k=1', () => {
    const [t] = scaleTiles([tile(1, 200, 100)], 1);
    expect(t.width).toBe(200);
  });

  it('exposes a scale floor so tiles never vanish', () => {
    expect(MIN_COMPOSITION_SCALE).toBeGreaterThan(0);
    expect(MIN_COMPOSITION_SCALE).toBeLessThan(1);
  });
});
```

```ts
// app/components/mosaic/v2/engine/compose.test.ts
import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import type { TileInput, V2Config } from './types';

const cfg = (over: Partial<V2Config> = {}): V2Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 400, curve: 'percentileAmongPassers',
  strategy: 'anchorRelax', bandCount: 8, horizontalAnchor: 'solarAltitude',
  rowAlign: 'center', geographicFidelity: 0.7, tileGapPx: 6, latNorth: 70, latSouth: -60,
  showFeedLabel: true, showTileRatings: false, showModelReadout: false,
  ...over,
});

const tile = (
  id: number, lat: number, passes: boolean, score: number | null, alt = -13
): TileInput => ({
  id, lat, lng: id, srcWidth: 400, srcHeight: 300, passes, score, sunAltitudeDeg: alt,
});

const viewport = { width: 1440, height: 2560 };

describe('compose — basics', () => {
  it('returns an empty layout for an empty pool', () => {
    const layout = compose([], viewport, cfg(), 'sunset');
    expect(layout.tiles).toEqual([]);
    expect(layout.dropped).toEqual([]);
    expect(layout.scale).toBe(1);
  });

  it('places every tile when the pool fits', () => {
    const layout = compose([tile(1, 50, true, 0.9), tile(2, 10, false, 0.1)], viewport, cfg(), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    expect(layout.dropped).toEqual([]);
  });

  it('keeps north above south', () => {
    // Narrow panel so the two equally-sized tiles cannot share a row.
    const layout = compose(
      [tile(1, -50, true, 0.5), tile(2, 60, true, 0.5)],
      { width: 400, height: 2560 },
      cfg(),
      'sunset'
    );
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(2)!.y).toBeLessThan(byId.get(1)!.y);
  });
});

describe('compose — visibility policies', () => {
  const pool = [tile(1, 50, true, 0.9), tile(2, 40, false, 0.4), tile(3, 30, false, 0.1)];

  it('hide removes gate-failers entirely', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'hide' }), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
  });

  it('showAtFloor keeps failers at exactly the floor', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'showAtFloor' }), 'sunset');
    expect(layout.tiles).toHaveLength(3);
    for (const t of layout.tiles.filter((x) => x.id !== 1)) {
      expect(t.height).toBe(100);
    }
  });

  it('maxTiles caps the total, keeping passers first', () => {
    const layout = compose(pool, viewport, cfg({ maxTiles: 2 }), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    expect(layout.tiles.map((t) => t.id)).toContain(1);
  });

  it('showIfRoom keeps all failers when there is plenty of room', () => {
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'showIfRoom' }), 'sunset');
    expect(layout.tiles).toHaveLength(3);
  });

  it('showIfRoom drops failers rather than shrinking a crowded composition', () => {
    const crowded = Array.from({ length: 60 }, (_, i) =>
      tile(i + 1, 60 - i * 2, i < 6, i < 6 ? 0.9 : 0.1)
    );
    const small = { width: 600, height: 700 };
    const room = compose(crowded, small, cfg({ failedCamPolicy: 'showIfRoom' }), 'sunset');
    const all = compose(crowded, small, cfg({ failedCamPolicy: 'showAtFloor' }), 'sunset');
    expect(room.tiles.length).toBeLessThan(all.tiles.length);
    // every passer survives
    for (let i = 1; i <= 6; i++) {
      expect(room.tiles.some((t) => t.id === i)).toBe(true);
    }
  });
});

describe('compose — overflow', () => {
  const crowded = Array.from({ length: 80 }, (_, i) => tile(i + 1, 60 - i * 1.5, false, 0.1));

  it('scales the whole composition down instead of culling', () => {
    const layout = compose(crowded, { width: 600, height: 800 }, cfg(), 'sunset');
    expect(layout.scale).toBeLessThan(1);
    expect(layout.dropped).toEqual([]);
    expect(layout.tiles).toHaveLength(80);
  });

  it('keeps the composition inside the panel', () => {
    const layout = compose(crowded, { width: 600, height: 800 }, cfg(), 'sunset');
    for (const t of layout.tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-0.001);
      expect(t.x + t.width).toBeLessThanOrEqual(600.001);
    }
  });

  it('drops only after the scale floor is exhausted, lowest scorers first', () => {
    const huge = Array.from({ length: 400 }, (_, i) =>
      tile(i + 1, 60 - i * 0.3, i === 0, i === 0 ? 0.99 : 0.01)
    );
    const layout = compose(huge, { width: 300, height: 400 }, cfg(), 'sunset');
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.tiles.some((t) => t.id === 1)).toBe(true); // the passer survives
  });
});

describe('compose — strategies', () => {
  it('latitudeBands quantises rows onto bands', () => {
    const layout = compose(
      [tile(1, 65, true, 0.5), tile(2, 62, true, 0.5)],
      viewport,
      cfg({ strategy: 'latitudeBands', bandCount: 4 }),
      'sunset'
    );
    // both fall in the same band, so they share a row centre
    expect(layout.tiles[0].y).toBe(layout.tiles[1].y);
  });

  it('is deterministic — the same input yields the same layout', () => {
    const pool = [tile(1, 50, true, 0.5), tile(2, 50, true, 0.5), tile(3, 20, false, null)];
    const a = compose(pool, viewport, cfg(), 'sunset');
    const b = compose(pool, viewport, cfg(), 'sunset');
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run app/components/mosaic/v2/engine/overflow.test.ts app/components/mosaic/v2/engine/compose.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement overflow**

```ts
// app/components/mosaic/v2/engine/overflow.ts
import type { SizedTile } from './types';

/**
 * How far the composition may shrink before dropping tiles becomes the
 * lesser evil. Below this everything is too small to read anyway.
 */
export const MIN_COMPOSITION_SCALE = 0.35;

/** Uniform scale — relative hierarchy and aspect ratios are preserved. */
export function scaleTiles(tiles: SizedTile[], k: number): SizedTile[] {
  if (k === 1) return tiles;
  return tiles.map((t) => ({ ...t, width: t.width * k, height: t.height * k }));
}
```

- [ ] **Step 4: Implement compose**

```ts
// app/components/mosaic/v2/engine/compose.ts
import { placeBands } from './bands';
import { altitudeRange, placeRowHorizontally } from './horizontalPlace';
import { MIN_COMPOSITION_SCALE, scaleTiles } from './overflow';
import { formRows } from './rows';
import { sizeTiles } from './sizing';
import { applyPolicy, capTiles, splitPool } from './visibility';
import { placeRowsVertically } from './verticalPlace';
import type { Layout, PlacedRow, SizedTile, TileInput, V2Config } from './types';

const MAX_SCALE_PASSES = 4;

function arrange(
  sized: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V2Config
): { rows: PlacedRow[]; extent: number } {
  if (cfg.strategy === 'latitudeBands') return placeBands(sized, viewport, cfg);
  const rows = formRows(sized, viewport.width, cfg.tileGapPx);
  return placeRowsVertically(rows, viewport.height, cfg);
}

/** Does this candidate set, sized and scaled, fit the panel height? */
function fits(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  scale: number
): boolean {
  const sized = scaleTiles(sizeTiles(candidates, cfg), scale);
  return arrange(sized, viewport, cfg).extent <= viewport.height;
}

/**
 * Largest prefix of `ordered` that still fits when appended to `base`.
 * Binary search, not one-at-a-time: more tiles is monotonically taller, and
 * a 400-tile pool would otherwise mean 400 full recompositions — the kind of
 * wall-clock blowup that has produced test flakes in this repo before.
 */
function largestFittingCount(
  base: TileInput[],
  ordered: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  scale: number
): number {
  let lo = 0;
  let hi = ordered.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits([...base, ...ordered.slice(0, mid)], viewport, cfg, scale)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The full v2 pipeline: signal-derived flags in, placed pixels out. Pure —
 * no DOM, no Image, no clock.
 *
 * Overflow NEVER culls arbitrarily (v1's named failure). The composition
 * shrinks uniformly first; only once it hits MIN_COMPOSITION_SCALE does it
 * drop, and then deterministically from the lowest-scoring gate-failers up.
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V2Config,
  feed: 'sunrise' | 'sunset'
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], scale: 1, viewport };
  }

  const { passers, failers } = splitPool(tiles);

  let candidates: TileInput[];
  if (cfg.failedCamPolicy === 'showIfRoom') {
    const room = largestFittingCount(passers, failers, viewport, cfg, 1);
    candidates = [...passers, ...failers.slice(0, room)];
  } else {
    candidates = applyPolicy(passers, failers, cfg);
  }
  candidates = capTiles(candidates, cfg.maxTiles);

  const droppedIds = new Set(
    tiles.filter((t) => !candidates.includes(t)).map((t) => t.id)
  );

  let sized = sizeTiles(candidates, cfg);
  let scale = 1;
  let placement = arrange(sized, viewport, cfg);

  for (let pass = 0; pass < MAX_SCALE_PASSES && placement.extent > viewport.height; pass++) {
    const needed = viewport.height / placement.extent;
    const next = Math.max(MIN_COMPOSITION_SCALE, scale * needed);
    if (next === scale) break;
    scale = next;
    sized = scaleTiles(sizeTiles(candidates, cfg), scale);
    placement = arrange(sized, viewport, cfg);
  }

  // Last resort: still overflowing at the scale floor. Keep the longest
  // prefix that fits — candidates run passers-first, weakest failers last,
  // so this drops exactly the tiles that matter least, deterministically.
  if (placement.extent > viewport.height) {
    const keep = Math.max(1, largestFittingCount([], candidates, viewport, cfg, scale));
    for (const t of candidates.slice(keep)) droppedIds.add(t.id);
    candidates = candidates.slice(0, keep);
    sized = scaleTiles(sizeTiles(candidates, cfg), scale);
    placement = arrange(sized, viewport, cfg);
  }

  const altRange = altitudeRange(sized);
  const placed = placement.rows.flatMap((row) =>
    placeRowHorizontally(row, viewport.width, cfg, feed, altRange)
  );

  return {
    tiles: placed,
    dropped: [...droppedIds],
    scale,
    viewport,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --run app/components/mosaic/v2/engine/overflow.test.ts app/components/mosaic/v2/engine/compose.test.ts`
Expected: PASS (4 + 13 tests).

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/engine/overflow.ts \
        app/components/mosaic/v2/engine/overflow.test.ts \
        app/components/mosaic/v2/engine/compose.ts \
        app/components/mosaic/v2/engine/compose.test.ts
git commit -m "feat(mosaic/v2): compose orchestrator with uniform-scale overflow"
```

---

### Task 10: Frame loader

**Files:**
- Create: `app/components/mosaic/v2/useLoadedTiles.ts`
- Test: `app/components/mosaic/v2/useLoadedTiles.test.ts`

**Interfaces:**
- Consumes: `readSignal` (Task 3), `sunAltitudeDeg` (Task 2), `TileInput` (Task 4).
- Produces: `useLoadedTiles(webcams, opts): LoadedTilesResult` where
  `opts: { qualitySource: QualitySource; gateThreshold: number; at?: string | number }`
  and `LoadedTilesResult = { tiles: TileInput[]; byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>; skipped: number; loading: boolean }`.

**Critical:** frames must be retried without `crossOrigin` on failure. `storage.googleapis.com` — the host for all ~59k production frame URLs — serves **no** CORS headers, so the CORS-first attempt always fails there. The canvas taints, which is fine because nothing reads pixels back.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/mosaic/v2/useLoadedTiles.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoadedTiles } from './useLoadedTiles';
import type { WindyWebcam } from '@/app/lib/types';

const cam = (id: number, preview: string | null, over: Partial<WindyWebcam> = {}): WindyWebcam =>
  ({
    webcamId: id,
    title: `cam ${id}`,
    viewCount: 0,
    status: 'active',
    location: { city: '', region: '', latitude: 45, longitude: -120, country: '', continent: '' },
    categories: [],
    images: preview ? { current: { preview } } : undefined,
    ...over,
  }) as WindyWebcam;

interface FakeImage {
  crossOrigin?: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
}

let created: FakeImage[] = [];

beforeEach(() => {
  created = [];
  vi.stubGlobal(
    'Image',
    class {
      crossOrigin?: string;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 300;
      #src = '';
      set src(v: string) {
        this.#src = v;
        created.push(this as unknown as FakeImage);
      }
      get src() {
        return this.#src;
      }
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

const opts = { qualitySource: 'auto' as const, gateThreshold: 0.55 };

describe('useLoadedTiles', () => {
  it('counts webcams with no preview as skipped', async () => {
    const { result } = renderHook(() => useLoadedTiles([cam(1, null)], opts));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skipped).toBe(1);
    expect(result.current.tiles).toEqual([]);
  });

  it('tries CORS first', async () => {
    renderHook(() => useLoadedTiles([cam(1, 'https://storage.googleapis.com/a.jpg')], opts));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].crossOrigin).toBe('anonymous');
  });

  it('retries WITHOUT crossOrigin when the CORS load fails', async () => {
    // storage.googleapis.com serves no CORS headers — this retry is the only
    // reason production frames render at all.
    renderHook(() => useLoadedTiles([cam(1, 'https://storage.googleapis.com/a.jpg')], opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onerror?.();
    await waitFor(() => expect(created).toHaveLength(2));
    expect(created[1].crossOrigin).toBeUndefined();
  });

  it('produces a tile with natural dimensions and signal fields', async () => {
    const { result } = renderHook(() =>
      useLoadedTiles(
        [cam(1, 'https://x/a.jpg', { aiRatingBinary: 4, aiRatingRegression: 5 })],
        opts
      )
    );
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));
    const tile = result.current.tiles[0];
    expect(tile).toMatchObject({
      id: 1, lat: 45, lng: -120, srcWidth: 400, srcHeight: 300, passes: true, score: 1,
    });
  });

  it('computes solar altitude at the supplied moment, not now', async () => {
    const { result } = renderHook(() =>
      useLoadedTiles([cam(1, 'https://x/a.jpg')], { ...opts, at: '2026-03-20T12:00:00Z' })
    );
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onload?.();
    await waitFor(() => expect(result.current.tiles).toHaveLength(1));
    const alt = result.current.tiles[0].sunAltitudeDeg!;
    // 45N 120W at 2026-03-20T12:00Z is ~04:00 local solar time — roughly
    // -21 deg. Asserted loosely; the point is "not computed for right now".
    expect(alt).toBeLessThan(-15);
  });

  it('counts a frame that fails both attempts as skipped', async () => {
    const { result } = renderHook(() => useLoadedTiles([cam(1, 'https://x/a.jpg')], opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].onerror?.();
    await waitFor(() => expect(created).toHaveLength(2));
    created[1].onerror?.();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skipped).toBe(1);
    expect(result.current.tiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/useLoadedTiles.test.ts`
Expected: FAIL — cannot resolve `./useLoadedTiles`.

- [ ] **Step 3: Write the implementation**

```ts
// app/components/mosaic/v2/useLoadedTiles.ts
'use client';

import { useEffect, useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { readSignal, type QualitySource } from './qualitySignal';
import { sunAltitudeDeg } from './solarPosition';
import type { TileInput } from './engine/types';

export interface LoadedTilesResult {
  tiles: TileInput[];
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  skipped: number;
  loading: boolean;
}

export interface LoadTilesOptions {
  qualitySource: QualitySource;
  gateThreshold: number;
  /** The moment to compute solar position for; defaults to render time. */
  at?: string | number;
}

const EMPTY: LoadedTilesResult = {
  tiles: [],
  byId: new Map(),
  skipped: 0,
  loading: false,
};

function momentOf(at?: string | number): Date {
  if (at === undefined) return new Date();
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Loads a preview image per webcam and resolves each to the TileInput the
 * engine needs: natural dimensions, the gate/score signal, and the sun's
 * altitude at that place and moment. Failed loads are skipped, never drawn
 * as black boxes, but they are counted.
 */
export function useLoadedTiles(
  webcams: WindyWebcam[],
  { qualitySource, gateThreshold, at }: LoadTilesOptions
): LoadedTilesResult {
  const [result, setResult] = useState<LoadedTilesResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const withPreview = webcams.filter((w) => w.images?.current?.preview);
    const noPreviewCount = webcams.length - withPreview.length;

    if (withPreview.length === 0) {
      setResult({ ...EMPTY, skipped: noPreviewCount });
      return () => {
        cancelled = true;
      };
    }

    setResult({ tiles: [], byId: new Map(), skipped: noPreviewCount, loading: true });

    const moment = momentOf(at);
    let settled = 0;
    let skipped = noPreviewCount;
    const tiles: TileInput[] = [];
    const byId = new Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>();

    const maybeFinish = () => {
      settled += 1;
      if (settled === withPreview.length && !cancelled) {
        setResult({ tiles: [...tiles], byId: new Map(byId), skipped, loading: false });
      }
    };

    // CORS first so CORS-enabled hosts (the Windy CDN) leave the canvas
    // untainted; storage.googleapis.com serves NO CORS headers, so that
    // attempt fails there and the retry without crossOrigin is what actually
    // renders production frames. Tainting is fine — nothing reads pixels back.
    const loadFrame = (webcam: WindyWebcam, withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        const { passes, score } = readSignal(webcam, qualitySource, gateThreshold);
        const { latitude, longitude } = webcam.location;
        tiles.push({
          id: webcam.webcamId,
          lat: latitude,
          lng: longitude,
          srcWidth: img.naturalWidth,
          srcHeight: img.naturalHeight,
          passes,
          score,
          sunAltitudeDeg: sunAltitudeDeg(moment, latitude, longitude),
        });
        byId.set(webcam.webcamId, { img, webcam });
        maybeFinish();
      };
      img.onerror = () => {
        if (cancelled) return;
        if (withCors) {
          loadFrame(webcam, false);
          return;
        }
        skipped += 1;
        maybeFinish();
      };
      img.src = webcam.images!.current!.preview;
    };

    for (const webcam of withPreview) loadFrame(webcam, true);

    return () => {
      cancelled = true;
    };
  }, [webcams, qualitySource, gateThreshold, at]);

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/components/mosaic/v2/useLoadedTiles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/useLoadedTiles.ts app/components/mosaic/v2/useLoadedTiles.test.ts
git commit -m "feat(mosaic/v2): frame loader with CORS retry and solar altitude"
```

---

### Task 11: Canvas renderer + overlays

**Files:**
- Create: `app/components/mosaic/v2/MosaicCanvas.tsx`
- Create: `app/components/mosaic/v2/overlays/FeedLabel.tsx`
- Create: `app/components/mosaic/v2/overlays/TileRatings.tsx`
- Create: `app/components/mosaic/v2/overlays/ModelReadout.tsx`
- Create: `app/components/mosaic/v2/overlays/SetupOverlay.tsx`
- Test: `app/components/mosaic/v2/MosaicCanvas.test.tsx`
- Test: `app/components/mosaic/v2/overlays/overlays.test.tsx`

**Interfaces:**
- Consumes: `Layout`, `PlacedTile` (Task 4); `detectionReadout`, `qualityReadout` from `@/app/lib/modelReadout` (shared with the other lane — read-only, do not modify).
- Produces:
  - `MosaicCanvas({ layout, byId, width, height, onSelect })`
  - `FeedLabel({ feed })`, `TileRatings({ layout, byId })`, `ModelReadout({ layout, byId })`, `SetupOverlay({ layout, feed, skipped })`

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/mosaic/v2/MosaicCanvas.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MosaicCanvas } from './MosaicCanvas';
import type { Layout } from './engine/types';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = { webcamId: 1, title: 'c' } as WindyWebcam;

const layout = (): Layout => ({
  tiles: [
    {
      id: 1, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
      passes: true, score: 0.5, sunAltitudeDeg: -13,
      width: 100, height: 75, pinnedToFloor: false, x: 10, y: 20,
    },
  ],
  dropped: [],
  scale: 1,
  viewport: { width: 300, height: 500 },
});

const byId = () =>
  new Map([[1, { img: {} as HTMLImageElement, webcam }]]);

describe('MosaicCanvas', () => {
  it('draws every placed tile at its position', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      resetTransform: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
      drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    render(<MosaicCanvas layout={layout()} byId={byId()} width={300} height={500} />);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 100, 75);
    vi.restoreAllMocks();
  });

  it('never reads pixels back — the canvas is tainted by design', () => {
    const getImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      resetTransform: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
      drawImage: vi.fn(), getImageData, imageSmoothingEnabled: false,
      imageSmoothingQuality: '', fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    render(<MosaicCanvas layout={layout()} byId={byId()} width={300} height={500} />);
    expect(getImageData).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
```

```tsx
// app/components/mosaic/v2/overlays/overlays.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedLabel } from './FeedLabel';
import { TileRatings } from './TileRatings';
import { SetupOverlay } from './SetupOverlay';
import type { Layout } from '../engine/types';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = {
  webcamId: 1, title: 'cam', aiRatingBinary: 4, aiRatingRegression: 4.2,
} as WindyWebcam;

const layout = (): Layout => ({
  tiles: [
    {
      id: 1, lat: 47.6, lng: -122.3, srcWidth: 400, srcHeight: 300,
      passes: true, score: 0.8, sunAltitudeDeg: -13,
      width: 100, height: 75, pinnedToFloor: false, x: 10, y: 20,
    },
  ],
  dropped: [7],
  scale: 0.8,
  viewport: { width: 300, height: 500 },
});

const byId = () => new Map([[1, { img: {} as HTMLImageElement, webcam }]]);

describe('FeedLabel', () => {
  it('shows the feed name in caps', () => {
    render(<FeedLabel feed="sunrise" />);
    expect(screen.getByText('SUNRISE')).toBeInTheDocument();
  });
});

describe('TileRatings', () => {
  it('renders a chip per tile showing the score', () => {
    render(<TileRatings layout={layout()} byId={byId()} />);
    expect(screen.getAllByTestId('v2-rating-chip')).toHaveLength(1);
  });

  it('marks gate-passers distinctly from floored tiles', () => {
    render(<TileRatings layout={layout()} byId={byId()} />);
    expect(screen.getByTestId('v2-rating-chip')).toHaveAttribute('data-passes', 'true');
  });
});

describe('SetupOverlay', () => {
  it('reports tile, dropped and skipped counts', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={3} />);
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('1');
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('3');
  });

  it('shows the applied composition scale so shrinking is visible', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={0} />);
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('0.80');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run app/components/mosaic/v2/MosaicCanvas.test.tsx app/components/mosaic/v2/overlays/overlays.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the canvas**

```tsx
// app/components/mosaic/v2/MosaicCanvas.tsx
'use client';

import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import type { Layout } from './engine/types';

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  webcam: WindyWebcam;
}

/**
 * Draws the composed layout. dpr-scaled, black backdrop, drawImage only —
 * frames come from a host with no CORS headers, so the canvas is tainted and
 * reading pixels back would throw. Click hit-testing uses rects captured at
 * draw time rather than the canvas itself.
 */
export function MosaicCanvas({
  layout,
  byId,
  width,
  height,
  onSelect,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  width: number;
  height: number;
  onSelect?: (webcam: WindyWebcam) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<HitRect[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.resetTransform?.();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const hits: HitRect[] = [];
    for (const tile of layout.tiles) {
      const entry = byId.get(tile.id);
      if (!entry) continue;
      ctx.drawImage(entry.img, tile.x, tile.y, tile.width, tile.height);
      hits.push({
        x: tile.x, y: tile.y, w: tile.width, h: tile.height, webcam: entry.webcam,
      });
    }
    hitRectsRef.current = hits;
  }, [layout, byId, width, height]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const hit of hitRectsRef.current) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        onSelect(hit.webcam);
        return;
      }
    }
  };

  return <canvas ref={canvasRef} onClick={handleClick} />;
}
```

- [ ] **Step 4: Implement the overlays**

```tsx
// app/components/mosaic/v2/overlays/FeedLabel.tsx
export function FeedLabel({ feed }: { feed: 'sunrise' | 'sunset' }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: 0.35,
        color: '#fff',
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
      }}
    >
      {feed === 'sunrise' ? 'SUNRISE' : 'SUNSET'}
    </div>
  );
}
```

```tsx
// app/components/mosaic/v2/overlays/TileRatings.tsx
import type { WindyWebcam } from '@/app/lib/types';
import type { Layout } from '../engine/types';

/** Per-tile score chip: the normalized quality and whether the gate passed. */
export function TileRatings({
  layout,
  byId,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => {
        if (!byId.has(tile.id)) return null;
        return (
          <div
            key={tile.id}
            data-testid="v2-rating-chip"
            data-passes={String(tile.passes)}
            style={{
              position: 'absolute',
              left: tile.x + 3,
              top: tile.y + 3,
              maxWidth: Math.max(0, tile.width - 6),
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: tile.passes ? '#4cc38a' : '#9aa3b2',
              fontFamily: 'monospace',
              fontSize: 10,
              textShadow: '0 1px 2px rgba(0,0,0,.9)',
            }}
          >
            {tile.score === null ? '—' : tile.score.toFixed(2)}
            {tile.passes ? ' ✓' : ''}
          </div>
        );
      })}
    </div>
  );
}
```

```tsx
// app/components/mosaic/v2/overlays/ModelReadout.tsx
import type { WindyWebcam } from '@/app/lib/types';
import { detectionReadout, qualityReadout } from '@/app/lib/modelReadout';
import type { Layout } from '../engine/types';

/** What each head said, per tile. Read-only decoration over the layout. */
export function ModelReadout({
  layout,
  byId,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
}) {
  return (
    <div
      data-testid="v2-model-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {layout.tiles.map((tile) => {
        const entry = byId.get(tile.id);
        if (!entry) return null;
        return (
          <div
            key={tile.id}
            data-testid="v2-model-chip"
            style={{
              position: 'absolute',
              left: tile.x + 3,
              top: tile.y + tile.height - 3,
              transform: 'translateY(-100%)',
              maxWidth: Math.max(0, tile.width - 6),
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 10,
              lineHeight: 1.35,
              textShadow: '0 1px 2px rgba(0,0,0,.9)',
            }}
          >
            <div>{detectionReadout(entry.webcam)}</div>
            <div>{qualityReadout(entry.webcam)}</div>
            {tile.pinnedToFloor && <div>floored</div>}
          </div>
        );
      })}
    </div>
  );
}
```

```tsx
// app/components/mosaic/v2/overlays/SetupOverlay.tsx
import type { Layout } from '../engine/types';

/** Installer aid: per-tile coordinates plus a composition health footer. */
export function SetupOverlay({
  layout,
  feed,
  skipped,
}: {
  layout: Layout;
  feed: 'sunrise' | 'sunset';
  skipped: number;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => (
        <div
          key={tile.id}
          style={{
            position: 'absolute',
            left: tile.x,
            top: tile.y + tile.height,
            transform: 'translateY(2px)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,.9)',
          }}
        >
          {tile.lat.toFixed(1)}, {tile.lng.toFixed(1)}
          {tile.sunAltitudeDeg !== null && ` · ${tile.sunAltitudeDeg.toFixed(1)}°`}
        </div>
      ))}
      <div
        data-testid="v2-setup-counts"
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: 12,
          textShadow: '0 1px 2px rgba(0,0,0,.9)',
        }}
      >
        {feed} · tiles {layout.tiles.length} · dropped {layout.dropped.length} ·
        skipped {skipped} · scale {layout.scale.toFixed(2)}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- --run app/components/mosaic/v2/MosaicCanvas.test.tsx app/components/mosaic/v2/overlays/overlays.test.tsx`
Expected: PASS (2 + 5 tests).

If `detectionReadout` / `qualityReadout` have different names or signatures, read `app/lib/modelReadout.ts` and adapt the call sites — **do not modify that file**, it is shared with the model lane.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/MosaicCanvas.tsx \
        app/components/mosaic/v2/MosaicCanvas.test.tsx \
        app/components/mosaic/v2/overlays/
git commit -m "feat(mosaic/v2): canvas renderer and overlay components"
```

---

### Task 12: Settings schema + component wiring

Replaces the Task 1 placeholders with the real thing. After this, every knob is live on the `/studio` rail.

**Files:**
- Modify: `app/components/mosaic/v2/settingsSchema.ts` (replace placeholder)
- Modify: `app/components/mosaic/v2/index.tsx` (replace placeholder)
- Test: `app/components/mosaic/v2/settingsSchema.test.ts`
- Test: `app/components/mosaic/v2/index.test.tsx` (extend Task 1's file)

**Interfaces:**
- Consumes: everything above; `mergeSettings` from `@/app/lib/settings/schema`.
- Produces: `V2_SETTINGS_SCHEMA` (18 knobs), `configFromSettings(values: SettingsValues): V2Config`.

- [ ] **Step 1: Write the failing schema test**

```ts
// app/components/mosaic/v2/settingsSchema.test.ts
import { describe, it, expect } from 'vitest';
import { V2_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

describe('V2_SETTINGS_SCHEMA', () => {
  it('has a knob for every composition decision', () => {
    const keys = V2_SETTINGS_SCHEMA.map((k) => k.key);
    for (const key of [
      'qualitySource', 'gateThreshold', 'failedCamPolicy', 'maxTiles',
      'floorPx', 'ceilingPx', 'curve',
      'strategy', 'bandCount', 'horizontalAnchor', 'rowAlign',
      'geographicFidelity', 'tileGapPx', 'latNorth', 'latSouth',
      'showFeedLabel', 'showTileRatings', 'showModelReadout',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('has no duplicate keys', () => {
    const keys = V2_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups knobs into rail sections', () => {
    const sections = new Set(V2_SETTINGS_SCHEMA.map((k) => k.section));
    expect(sections).toEqual(
      new Set(['signal', 'visibility', 'sizing', 'arrangement', 'overlays'])
    );
  });

  it('gives every number knob a range that contains its default', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      if (knob.kind !== 'number') continue;
      expect(knob.default).toBeGreaterThanOrEqual(knob.min);
      expect(knob.default).toBeLessThanOrEqual(knob.max);
    }
  });

  it('gives every enum knob a default among its options', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      if (knob.kind !== 'enum') continue;
      expect(knob.options).toContain(knob.default);
    }
  });

  it('describes every knob for the rail tooltip', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      expect(knob.description.length).toBeGreaterThan(0);
      expect(knob.label.length).toBeGreaterThan(0);
    }
  });

  it('defaults gateThreshold to 0.55 on the probability scale', () => {
    const gate = V2_SETTINGS_SCHEMA.find((k) => k.key === 'gateThreshold')!;
    expect(gate.default).toBe(0.55);
    expect(gate.kind).toBe('number');
    if (gate.kind === 'number') {
      expect(gate.min).toBe(0);
      expect(gate.max).toBe(1);
    }
  });

  it('defaults to the decided arrangement', () => {
    const byKey = Object.fromEntries(V2_SETTINGS_SCHEMA.map((k) => [k.key, k.default]));
    expect(byKey.strategy).toBe('anchorRelax');
    expect(byKey.horizontalAnchor).toBe('solarAltitude');
    expect(byKey.failedCamPolicy).toBe('showAtFloor');
    expect(byKey.geographicFidelity).toBe(0.7);
    expect(byKey.floorPx).toBe(100);
    expect(byKey.ceilingPx).toBe(480);
  });
});

describe('configFromSettings', () => {
  it('round-trips the schema defaults into a full V2Config', () => {
    const cfg = configFromSettings(schemaDefaults(V2_SETTINGS_SCHEMA));
    expect(cfg.strategy).toBe('anchorRelax');
    expect(cfg.horizontalAnchor).toBe('solarAltitude');
    expect(cfg.gateThreshold).toBe(0.55);
    expect(cfg.maxTiles).toBe(0);
  });

  it('carries dial changes through', () => {
    const cfg = configFromSettings({
      ...schemaDefaults(V2_SETTINGS_SCHEMA),
      geographicFidelity: 1,
      rowAlign: 'justify',
    });
    expect(cfg.geographicFidelity).toBe(1);
    expect(cfg.rowAlign).toBe('justify');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/components/mosaic/v2/settingsSchema.test.ts`
Expected: FAIL — `configFromSettings` is not exported.

- [ ] **Step 3: Write the real schema**

```ts
// app/components/mosaic/v2/settingsSchema.ts
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { V2Config } from './engine/types';

/**
 * Every v2 composition knob. Defaults here ARE what the engine does with no
 * settings present — the done-signal for phase 2 is that no composition
 * constant survives in source.
 */
export const V2_SETTINGS_SCHEMA: SettingsSchema = [
  {
    key: 'qualitySource', kind: 'enum', options: ['auto', 'model', 'llm'] as const,
    default: 'auto', label: 'quality source', section: 'signal',
    description:
      'Which judge sizes the tiles. auto = ML heads when scored, else Claude — required because reconstructed scenes carry only llm_* and live captures only the ML heads.',
  },
  {
    key: 'gateThreshold', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.55,
    label: 'gate threshold', section: 'visibility',
    description: 'Detection probability a frame must clear to count as a sunset. A probability in [0,1], not a 1-5 rating.',
  },
  {
    key: 'failedCamPolicy', kind: 'enum',
    options: ['hide', 'showAtFloor', 'showIfRoom'] as const, default: 'showAtFloor',
    label: 'failed cams', section: 'visibility',
    description: 'What happens to frames that fail the gate: drop them, show them all at floor size, or show as many as fit.',
  },
  {
    key: 'maxTiles', kind: 'number', min: 0, max: 300, step: 1, default: 0,
    label: 'max tiles', section: 'visibility',
    description: 'Hard ceiling on tile count, passers kept first. 0 means unlimited.',
  },
  {
    key: 'floorPx', kind: 'number', min: 20, max: 600, step: 10, default: 100,
    label: 'floor (px)', section: 'sizing',
    description: 'Height of the smallest tile. Gate-failers pin to exactly this.',
  },
  {
    key: 'ceilingPx', kind: 'number', min: 50, max: 1200, step: 10, default: 480,
    label: 'ceiling (px)', section: 'sizing',
    description: 'Height of the best-scoring gate-passer.',
  },
  {
    key: 'curve', kind: 'enum',
    options: ['linear', 'easeIn', 'percentileAmongPassers'] as const,
    default: 'percentileAmongPassers', label: 'curve', section: 'sizing',
    description: 'How passer scores map onto the floor-to-ceiling range. percentileAmongPassers ranks within the passers only.',
  },
  {
    key: 'strategy', kind: 'enum',
    options: ['anchorRelax', 'latitudeBands'] as const, default: 'anchorRelax',
    label: 'strategy', section: 'arrangement',
    description: 'anchorRelax floats rows at their true latitude; latitudeBands quantises them into fixed zones.',
  },
  {
    key: 'bandCount', kind: 'number', min: 2, max: 24, step: 1, default: 8,
    label: 'band count', section: 'arrangement',
    description: 'Number of latitude zones. Only used by the latitudeBands strategy.',
  },
  {
    key: 'horizontalAnchor', kind: 'enum',
    options: ['solarAltitude', 'order'] as const, default: 'solarAltitude',
    label: 'horizontal axis', section: 'arrangement',
    description: 'solarAltitude places tiles by depth into twilight; order just packs them west to east.',
  },
  {
    key: 'rowAlign', kind: 'enum',
    options: ['center', 'justify', 'west'] as const, default: 'center',
    label: 'row align', section: 'arrangement',
    description: 'Where a row\'s slack goes. Only used when the horizontal axis is order.',
  },
  {
    key: 'geographicFidelity', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.7,
    label: 'geographic fidelity', section: 'arrangement',
    description: '1 keeps rows at true latitude so gaps stay gaps; 0 packs them densely and leaves geography as ordering only.',
  },
  {
    key: 'tileGapPx', kind: 'number', min: 0, max: 40, step: 1, default: 6,
    label: 'tile gap (px)', section: 'arrangement',
    description: 'Space between neighbouring tiles.',
  },
  {
    key: 'latNorth', kind: 'number', min: 0, max: 90, step: 1, default: 70,
    label: 'north edge', section: 'arrangement',
    description: 'Latitude mapped to the top of the panel.',
  },
  {
    key: 'latSouth', kind: 'number', min: -90, max: 0, step: 1, default: -60,
    label: 'south edge', section: 'arrangement',
    description: 'Latitude mapped to the bottom of the panel.',
  },
  {
    key: 'showFeedLabel', kind: 'boolean', default: true,
    label: 'feed label', section: 'overlays',
    description: 'SUNRISE / SUNSET title across the top.',
  },
  {
    key: 'showTileRatings', kind: 'boolean', default: false,
    label: 'tile ratings', section: 'overlays',
    description: 'Per-tile score and gate verdict.',
  },
  {
    key: 'showModelReadout', kind: 'boolean', default: false,
    label: 'model readout', section: 'overlays',
    description: 'What each model head said about each frame.',
  },
] as const;

/** Merged dial values to the engine's config shape. */
export function configFromSettings(values: SettingsValues): V2Config {
  return {
    qualitySource: values.qualitySource as V2Config['qualitySource'],
    gateThreshold: values.gateThreshold as number,
    failedCamPolicy: values.failedCamPolicy as V2Config['failedCamPolicy'],
    maxTiles: values.maxTiles as number,
    floorPx: values.floorPx as number,
    ceilingPx: values.ceilingPx as number,
    curve: values.curve as V2Config['curve'],
    strategy: values.strategy as V2Config['strategy'],
    bandCount: values.bandCount as number,
    horizontalAnchor: values.horizontalAnchor as V2Config['horizontalAnchor'],
    rowAlign: values.rowAlign as V2Config['rowAlign'],
    geographicFidelity: values.geographicFidelity as number,
    tileGapPx: values.tileGapPx as number,
    latNorth: values.latNorth as number,
    latSouth: values.latSouth as number,
    showFeedLabel: values.showFeedLabel as boolean,
    showTileRatings: values.showTileRatings as boolean,
    showModelReadout: values.showModelReadout as boolean,
  };
}
```

- [ ] **Step 4: Write the failing component test**

Append to `app/components/mosaic/v2/index.test.tsx`:

```tsx
describe('MosaicV2 wiring', () => {
  it('honours the showFeedLabel knob', () => {
    const { queryByText, rerender } = render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: false }} />
    );
    expect(queryByText('SUNSET')).toBeNull();
    rerender(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: true }} />
    );
    expect(queryByText('SUNSET')).toBeInTheDocument();
  });

  it('lets ?models=1 beat the showModelReadout knob', () => {
    const { queryByTestId, rerender } = render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v2-model-overlay')).toBeNull();

    rerender(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=1" settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v2-model-overlay')).toBeInTheDocument();
  });

  it('lets ?models=0 turn the readout off even when the knob is on', () => {
    render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=0" settings={{ showModelReadout: true }} />
    );
    expect(screen.queryByTestId('v2-model-overlay')).toBeNull();
  });

  it('renders setup mode without crashing on an empty pool', () => {
    render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunrise" setupMode />
    );
    expect(screen.getByTestId('v2-setup-counts')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write the real component**

```tsx
// app/components/mosaic/v2/index.tsx
'use client';

import { useMemo } from 'react';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { MosaicProps } from '../types';
import { compose } from './engine/compose';
import { MosaicCanvas } from './MosaicCanvas';
import { FeedLabel } from './overlays/FeedLabel';
import { ModelReadout } from './overlays/ModelReadout';
import { SetupOverlay } from './overlays/SetupOverlay';
import { TileRatings } from './overlays/TileRatings';
import { V2_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { useLoadedTiles } from './useLoadedTiles';

/**
 * v2 — latitude anchoring plus depth-into-twilight arrangement, entirely
 * schema-driven. Precedence, as everywhere: URL param, then profile setting,
 * then code default.
 */
export function MosaicV2({
  webcams,
  width,
  height,
  feed,
  setupMode = false,
  onSelect,
  search = '',
  settings,
  at,
}: MosaicProps) {
  const { cfg, modelsMode } = useMemo(() => {
    const params = new URLSearchParams(search);
    const merged = mergeSettings(V2_SETTINGS_SCHEMA, settings);
    return {
      cfg: configFromSettings(merged),
      modelsMode: params.has('models')
        ? params.get('models') === '1'
        : merged.showModelReadout === true,
    };
  }, [search, settings]);

  const { tiles, byId, skipped } = useLoadedTiles(webcams, {
    qualitySource: cfg.qualitySource,
    gateThreshold: cfg.gateThreshold,
    at,
  });

  const layout = useMemo(
    () => compose(tiles, { width, height }, cfg, feed),
    [tiles, width, height, cfg, feed]
  );

  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      <MosaicCanvas
        layout={layout}
        byId={byId}
        width={width}
        height={height}
        onSelect={onSelect}
      />
      {cfg.showFeedLabel && <FeedLabel feed={feed} />}
      {cfg.showTileRatings && <TileRatings layout={layout} byId={byId} />}
      {modelsMode && <ModelReadout layout={layout} byId={byId} />}
      {setupMode && <SetupOverlay layout={layout} feed={feed} skipped={skipped} />}
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- --run app/components/mosaic/v2/`
Expected: PASS across the whole v2 folder.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v2/settingsSchema.ts \
        app/components/mosaic/v2/settingsSchema.test.ts \
        app/components/mosaic/v2/index.tsx \
        app/components/mosaic/v2/index.test.tsx
git commit -m "feat(mosaic/v2): full settings schema and component wiring"
```

---

### Task 13: Thread the scene moment through /studio

Without this, previewing a historical scene computes the sun's position at *today's* time and the twilight axis is meaningless.

**Files:**
- Modify: `app/studio/useSceneWebcams.ts`
- Modify: `app/studio/PreviewPane.tsx`
- Modify: `app/studio/StudioClient.tsx`
- Test: `app/studio/useSceneWebcams.test.ts` (extend)
- Test: `app/studio/PreviewPane.test.tsx` (extend)

**Interfaces:**
- Consumes: `Scene.representsAt` from `@/app/lib/scenes/types`.
- Produces: `useSceneWebcams(...)` gains `sceneRepresentsAt: string | null`; `PreviewPane` gains an optional `at?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `app/studio/useSceneWebcams.test.ts`. This block stubs `fetch`
itself so it does not depend on whatever mocking the existing tests in the
file use — read the file first and reuse its helpers if they are cleaner.

```ts
describe('useSceneWebcams — scene moment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', (url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url === '/api/kiosk/scenes'
              ? { scenes: [] }
              : {
                  id: 2,
                  label: 'Equinox full glass',
                  tags: [],
                  notes: '',
                  representsAt: '2026-03-14T17:30:00.000Z',
                  source: 'historical',
                  createdAt: '2026-03-14T18:00:00.000Z',
                  state: { sunrise: [], sunset: [] },
                  provenance: null,
                }
          ),
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exposes the selected scene\'s representsAt', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'scene', id: 2 }));
    await waitFor(() =>
      expect(result.current.sceneRepresentsAt).toBe('2026-03-14T17:30:00.000Z')
    );
  });

  it('has no moment when the source is live', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'live' }));
    await waitFor(() => expect(result.current.sceneRepresentsAt).toBeNull());
  });
});
```

SWR caches across tests in the same file. If these interfere with existing
cases, wrap the hook in an `SWRConfig` with `provider: () => new Map()`.

Append to `app/studio/PreviewPane.test.tsx`:

```tsx
it('passes the scene moment down to the mosaic', () => {
  // Assert via the rendered mosaic receiving `at` — follow this file's
  // existing approach of rendering PreviewPane and inspecting output.
  render(
    <PreviewPane
      view="sunset"
      onViewChange={() => {}}
      panel={{ width: 300, height: 500 }}
      panelPresetLabel="test"
      versionName="v2"
      at="2026-03-14T17:30:00.000Z"
    />
  );
  expect(screen.getByText('SUNSET')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run app/studio/useSceneWebcams.test.ts app/studio/PreviewPane.test.tsx`
Expected: FAIL — `sceneRepresentsAt` undefined; `at` not a valid prop.

- [ ] **Step 3: Surface the moment from the hook**

In `app/studio/useSceneWebcams.ts`, extend the return type and value:

```ts
export function useSceneWebcams(source: SceneSource): {
  scenes: SceneSummary[];
  sceneState: SceneState | null;
  sceneLabel: string | null;
  sceneRepresentsAt: string | null;
  error: string | null;
} {
```

```ts
  return {
    scenes: list.data?.scenes ?? [],
    sceneState: scene.data?.state ?? null,
    sceneLabel: scene.data?.label ?? null,
    sceneRepresentsAt: scene.data?.representsAt ?? null,
    error: (list.error ?? scene.error)?.message ?? null,
  };
```

- [ ] **Step 4: Accept and forward `at` in PreviewPane**

Add `at` to the props type and destructuring:

```ts
  at,
}: {
  // ...existing props...
  at?: string;
}) {
```

and pass it to the mosaic:

```tsx
                <Mosaic
                  webcams={webcamsFor(feed)}
                  width={panel.width}
                  height={panel.height}
                  feed={feed}
                  search=""
                  settings={settings}
                  at={at}
                />
```

- [ ] **Step 5: Thread it in StudioClient**

Pull `sceneRepresentsAt` out of the hook:

```ts
  const { scenes, sceneState, sceneRepresentsAt, error: sceneError } =
    useSceneWebcams(sceneSource);
```

and pass it to `PreviewPane`, alongside the existing props:

```tsx
          at={sceneRepresentsAt ?? undefined}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- --run app/studio/`
Expected: PASS — the whole studio suite, including the pre-existing tests.

- [ ] **Step 7: Full suite, lint, and build**

```bash
npm run test -- --run
npm run lint
npm run build
```

Expected: all green. `npm run build` matters here — it is the only check that catches a type error in a file no test imports.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/studio/useSceneWebcams.ts app/studio/useSceneWebcams.test.ts \
        app/studio/PreviewPane.tsx app/studio/PreviewPane.test.tsx \
        app/studio/StudioClient.tsx
git commit -m "feat(studio): pass the scene moment to the mosaic for solar math"
```

---

## Done signal

Phase 2 is complete when:

1. `npm run test -- --run`, `npm run lint`, and `npm run build` are all green.
2. `/studio` → version switcher → **v2** renders, and every knob in the five sections turns something visible.
3. Switching `horizontalAnchor` between `solarAltitude` and `order` visibly changes the composition on the **live capture** scene.
4. `geographicFidelity` at 1 leaves visible latitude gaps; at 0 it packs densely.
5. `?v=v2` renders on the kiosk pages for on-glass A/B against v1.
6. No composition constant remains in v2 source that should have been a knob.

**Not** part of this plan: promotion (`activeVersion` flip), motion and hysteresis (phase 3), the reconstructed-scene timestamp skew.

## Notes for the executor

- Judging the composition on the two historical seed scenes is **partly invalid** — they are not terminator pools (see the decisions doc). Use the **live capture** scene for anything gate- or twilight-related.
- `app/studio/StudioClient.tsx` still imports `passesGate` from **v1** for its status-strip counts, so those counts describe v1's interpretation even while previewing v2. Left deliberately: it is a shared-helper touch on the model lane. Do not change it in this plan; flag it for a follow-up with a heads-up message to that session.
