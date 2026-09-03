# Mosaic v3 — the band paradigm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship mosaic `v3` — a wall whose vertical axis is fixed latitude bands and whose horizontal axis is absolute solar altitude, where a tile's position never depends on who else is in the pool, and crowding is resolved by evicting the lower-quality tile rather than by moving anybody.

**Architecture:** `v3` is a new registry entry beside `v1` and `v2`, seeded as a copy of `v2` and then rewritten in its own folder. The engine's row-formation, vertical-relax and horizontal de-overlap passes are deleted outright and replaced by three small pure modules — `axis.ts` (x from solar altitude), `bands.ts` (y from latitude), `evict.ts` (2D collision resolved by quality, with hysteresis). `compose()` stays pure; the cross-tick memory hysteresis needs is passed in as an argument from `index.tsx`.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19, Vitest + jsdom + Testing Library, `suncalc`, `leva` (studio rail), Neon serverless Postgres (fixture generation only).

**Spec:** `docs/superpowers/specs/2026-09-02-mosaic-v3-band-paradigm-design.md`
**Sibling spec (Plan B, not built here):** `docs/superpowers/specs/2026-09-02-terminator-pool-coverage-design.md`

---

## Global Constraints

- **Branch:** `feat/mosaic-v3-band-paradigm`, an ordinary branch in the main checkout. **Never** create a worktree in this repo. Verify with `git rev-parse --abbrev-ref HEAD` before every commit.
- **Staging:** other Claude sessions share this one checkout. **Never** `git add -A` or `git add .` — stage the exact paths listed in each Commit step and nothing else.
- **`DEFAULT_MOSAIC_VERSION` stays `'v1'`.** Promoting v3 is out of scope.
- **Do not touch `app/components/mosaic/v1/` or `app/components/mosaic/v2/`.** Versions are independent by design. Do not refactor shared code out of them, and do not "fix" v2 with anything learned here.
- **Do not chase the small-to-large-to-small arc.** Spec §1 states v3 cannot produce it on today's pool; that is the sibling spec's job.
- **Do not migrate `webcam_snapshots.captured_at` to `timestamptz`.** Spec §2 investigated and closed that question. The timestamps are correct.
- **`compose()` is pure.** No module-level state, no clock reads, no hooks inside `app/components/mosaic/v3/engine/`. State and clock arrive as arguments.
- Run `npm run test` (vitest) for tests and `npm run lint` before the final commit of each task.
- **Do not use `npx tsc --noEmit` as a gate.** It reports 185 pre-existing errors on `main`, all in test files whose jest-dom matchers are not wired into `tsconfig.json`. Typecheck with `npm run build` instead, which is what checks app code here. Measured 2026-09-02.
- **Never `git stash` or `git checkout` another branch.** Other sessions' uncommitted files live in this checkout and a stash sweeps them up.
- Exact default values, copied from the spec: `hysteresisMargin` `0.05`, `minDwellMs` `90000`, `axisNightEdgeDeg` `-24`, `axisDayEdgeDeg` `-2`.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `app/components/mosaic/v3/**` | The whole v3 version — engine, overlays, hooks, settings schema. Seeded from v2 in Task 1, then rewritten. |
| `app/components/mosaic/v3/engine/axis.ts` | Solar altitude → absolute x. Owns the display window dials. |
| `app/components/mosaic/v3/engine/bands.ts` | Latitude → fixed band index → absolute y. Pure in latitude. |
| `app/components/mosaic/v3/engine/evict.ts` | 2D collision, effective quality ordering, incumbency bonus, minimum dwell. |
| `app/components/mosaic/v3/engine/__fixtures__/live-capture-pool.json` | The 21 sunrise / 42 sunset live-capture scene, trimmed, as the trustworthy test pool. |
| `app/components/mosaic/v3/engine/fixturePool.ts` | Test helper: fixture rows → `TileInput[]` through the real `readSignal` and `sunAltitudeDeg`. |
| `app/components/mosaic/v3/overlays/CentreLine.tsx` | The terminator-ring centre line. |
| `scripts/export-scene-pool.mjs` | One-shot generator for the fixture above. |

**Modified**

| Path | Change |
|---|---|
| `app/components/mosaic/registry.ts` | `v3` rows in `MOSAIC_VERSIONS` and `MOSAIC_SETTINGS_SCHEMAS`. |
| `app/components/mosaic/types.ts` | New `allowDebugOverlays?: boolean` on `MosaicProps`. |
| `app/lib/masterConfig.ts` | New `POOL_ALTITUDE_COVERAGE_DEG` — the Plan A / Plan B boundary contract. |
| `app/kiosk/sunrise/page.tsx`, `app/kiosk/sunset/page.tsx` | Pass `allowDebugOverlays` from `?debug=1`. |

**Deleted (inside v3 only, in Task 6)**

`app/components/mosaic/v3/engine/rows.ts`, `verticalPlace.ts`, `horizontalPlace.ts` and their tests. Their passes are the disease v3 cures.

---

## Task Overview

| # | Deliverable |
|---|---|
| 1 | v3 registered and rendering, byte-equivalent to v2 |
| 2 | `axis.ts` + the Plan A/Plan B coverage-constant contract |
| 3 | `bands.ts` — fixed bands, absolute y |
| 4 | `evict.ts` — 2D collision resolved by quality |
| 5 | Hysteresis: incumbency bonus and minimum dwell |
| 6 | `compose.ts` rewritten; old passes deleted; schema swapped |
| 7 | Real-pool fixture and the headline invariance test |
| 8 | `index.tsx` wires the history; setup overlay reports evictions |
| 9 | The centre line overlay, structurally off on the glass |

---

### Task 1: Seed v3 from v2 and register it

Nothing behaves differently yet. The deliverable is that `?v=v3` renders, the studio rail shows a v3 folder set, and the settings API accepts a `v3` namespace — so every later task changes one thing at a time inside a folder that already works.

**Files:**
- Create: `app/components/mosaic/v3/` (recursive copy of `app/components/mosaic/v2/`)
- Modify: `app/components/mosaic/registry.ts`
- Test: `app/components/mosaic/v3/index.test.tsx` (arrives with the copy; edit it)

**Interfaces:**
- Consumes: nothing.
- Produces: `MosaicV3` (a `MosaicComponent`), `V3_SETTINGS_SCHEMA: SettingsSchema`, `V3Config` (in `app/components/mosaic/v3/engine/types.ts`), `configFromSettings(values: SettingsValues): V3Config`, `motionFromSettings(values: SettingsValues): { motion: MotionConfig; crossfadeMs: number }`. Registry keys `MOSAIC_VERSIONS.v3` and `MOSAIC_SETTINGS_SCHEMAS.v3`.

- [ ] **Step 1: Copy the v2 folder**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
cp -R app/components/mosaic/v2 app/components/mosaic/v3
```

- [ ] **Step 2: Rename every v2 identifier to v3 inside the new folder only**

macOS `sed` needs the `-i ''` form. This touches only files under `v3/`.

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
find app/components/mosaic/v3 -type f \
  -exec sed -i '' \
    -e 's/MosaicV2/MosaicV3/g' \
    -e 's/V2_SETTINGS_SCHEMA/V3_SETTINGS_SCHEMA/g' \
    -e 's/V2Config/V3Config/g' \
    -e 's/v2-setup-counts/v3-setup-counts/g' \
    {} +
```

Then fix the prose by hand. Open these three files and reword the comments that name v2 so they describe v3 (the band paradigm), not v2 (floating rows):

- `app/components/mosaic/v3/index.tsx` — the component doc comment
- `app/components/mosaic/v3/settingsSchema.ts` — the schema doc comment
- `app/components/mosaic/v3/qualitySignal.ts` — the "THE v2 quality signal" comment

- [ ] **Step 3: Write the failing registry test**

Replace the whole of `app/components/mosaic/v3/index.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { MosaicV3 } from './index';
import { MOSAIC_VERSIONS, MOSAIC_SETTINGS_SCHEMAS, resolveMosaic } from '../registry';
import { DEFAULT_MOSAIC_VERSION } from '../registry';

describe('v3 registration', () => {
  it('is reachable under the v3 key', () => {
    expect(MOSAIC_VERSIONS.v3).toBe(MosaicV3);
    expect(resolveMosaic('v3')).toBe(MosaicV3);
  });

  it('ships a settings schema in its own namespace', () => {
    expect(Array.isArray(MOSAIC_SETTINGS_SCHEMAS.v3)).toBe(true);
    expect(MOSAIC_SETTINGS_SCHEMAS.v3.length).toBeGreaterThan(0);
  });

  it('does not disturb the pinned default', () => {
    expect(DEFAULT_MOSAIC_VERSION).toBe('v1');
  });

  it('gives v3 a schema object distinct from v2 so their dials cannot alias', () => {
    expect(MOSAIC_SETTINGS_SCHEMAS.v3).not.toBe(MOSAIC_SETTINGS_SCHEMAS.v2);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/index.test.tsx`
Expected: FAIL — `MOSAIC_VERSIONS.v3` is `undefined`.

- [ ] **Step 5: Add the registry rows**

In `app/components/mosaic/registry.ts`, add the imports beneath the v2 ones:

```ts
import { MosaicV3 } from './v3';
import { V3_SETTINGS_SCHEMA } from './v3/settingsSchema';
```

and the rows:

```ts
export const MOSAIC_VERSIONS: Record<string, MosaicComponent> = {
  v1: MosaicV1,
  v2: MosaicV2,
  v3: MosaicV3,
};
```

```ts
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
  v2: V2_SETTINGS_SCHEMA,
  v3: V3_SETTINGS_SCHEMA,
};
```

Leave `DEFAULT_MOSAIC_VERSION` at `'v1'`.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. The copied v3 tests all pass because v3 is still v2. If `app/api/kiosk/settings/route.test.ts` fails, it mocks the registry — read its mock and leave it alone unless it genuinely broke.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3 app/components/mosaic/registry.ts
git commit -m "feat(mosaic): seed v3 from v2 and register it beside v1 and v2"
```

---

### Task 2: The axis — solar altitude to an absolute x, on its own dials

Spec §6. The horizontal window stops being derived from the cron's constants and becomes two dials. The property decision 6a wanted — that the axis tracks what the sweep actually gathers — is replaced by a test against a named coverage constant, which is also the Plan A / Plan B boundary contract from §8.

Nothing imports `axis.ts` yet. That is deliberate: it lands green and unused, and Task 6 swaps it in.

**Files:**
- Create: `app/components/mosaic/v3/engine/axis.ts`
- Create: `app/components/mosaic/v3/engine/axis.test.ts`
- Modify: `app/lib/masterConfig.ts`

**Interfaces:**
- Consumes: `SizedTile` from `./types` (already present from Task 1's copy).
- Produces:
  - `interface AxisConfig { axisNightEdgeDeg: number; axisDayEdgeDeg: number }`
  - `altitudeToUnit(altDeg: number, cfg: AxisConfig, feed: 'sunrise' | 'sunset'): number`
  - `tileX(tile: SizedTile, viewportWidth: number, cfg: AxisConfig, feed: 'sunrise' | 'sunset'): number`
  - `POOL_ALTITUDE_COVERAGE_DEG: { readonly min: number; readonly max: number }` from `@/app/lib/masterConfig`

- [ ] **Step 1: Write the failing test**

Create `app/components/mosaic/v3/engine/axis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { altitudeToUnit, tileX, type AxisConfig } from './axis';
import { POOL_ALTITUDE_COVERAGE_DEG, TERMINATOR_SUN_ALTITUDE_DEG } from '@/app/lib/masterConfig';
import { V3_SETTINGS_SCHEMA } from '../settingsSchema';
import type { SizedTile } from './types';

const cfg: AxisConfig = { axisNightEdgeDeg: -24, axisDayEdgeDeg: -2 };

const sized = (over: Partial<SizedTile> = {}): SizedTile => ({
  id: 1, lat: 0, lng: 0, srcWidth: 400, srcHeight: 224,
  passes: true, score: 0.8, sunAltitudeDeg: -13,
  width: 200, height: 112, pinnedToFloor: false,
  ...over,
});

describe('altitudeToUnit', () => {
  it('puts the pool ring at the centre of the panel on both feeds', () => {
    expect(altitudeToUnit(-13, cfg, 'sunset')).toBeCloseTo(0.5, 6);
    expect(altitudeToUnit(-13, cfg, 'sunrise')).toBeCloseTo(0.5, 6);
  });

  it('puts the day side on the LEFT for sunset and the RIGHT for sunrise', () => {
    // Spec §3: west stays on the left, so the day edge swaps between feeds.
    expect(altitudeToUnit(-2, cfg, 'sunset')).toBeCloseTo(0, 6);
    expect(altitudeToUnit(-2, cfg, 'sunrise')).toBeCloseTo(1, 6);
  });

  it('clamps altitudes outside the window to an edge rather than widening it', () => {
    expect(altitudeToUnit(10, cfg, 'sunrise')).toBe(1);
    expect(altitudeToUnit(-90, cfg, 'sunrise')).toBe(0);
  });

  it('does not depend on the pool: the same altitude gives the same unit always', () => {
    expect(altitudeToUnit(-8, cfg, 'sunset')).toBe(altitudeToUnit(-8, cfg, 'sunset'));
  });

  it('degenerates to the centre rather than dividing by zero', () => {
    expect(altitudeToUnit(-13, { axisNightEdgeDeg: -2, axisDayEdgeDeg: -2 }, 'sunset')).toBe(0.5);
  });
});

describe('tileX', () => {
  it('centres a tile at the pool ring exactly on the panel centre line', () => {
    const t = sized({ sunAltitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG, width: 200 });
    const x = tileX(t, 1080, cfg, 'sunset');
    expect(x + t.width / 2).toBeCloseTo(540, 6);
  });

  it('keeps a tile inside the panel at both edges', () => {
    const wide = sized({ width: 900 });
    expect(tileX({ ...wide, sunAltitudeDeg: -2 }, 1080, cfg, 'sunset')).toBe(0);
    expect(tileX({ ...wide, sunAltitudeDeg: -24 }, 1080, cfg, 'sunset')).toBe(180);
  });

  it('parks an unknown moment at the centre instead of an edge', () => {
    const t = sized({ sunAltitudeDeg: null, width: 200 });
    expect(tileX(t, 1080, cfg, 'sunset')).toBeCloseTo(440, 6);
  });

  it('never goes negative when a tile is wider than the panel', () => {
    expect(tileX(sized({ width: 2000 }), 1080, cfg, 'sunset')).toBe(0);
  });
});

describe('the Plan A / Plan B boundary (spec §6 and §8)', () => {
  const defaultOf = (key: string): number => {
    const knob = V3_SETTINGS_SCHEMA.find((k) => k.key === key);
    if (!knob || knob.kind !== 'number') throw new Error(`no number knob ${key}`);
    return knob.default;
  };

  it('the display window covers every altitude the sweep gathers', () => {
    // If this fails, the pool-coverage work widened POOL_ALTITUDE_COVERAGE_DEG
    // without moving the v3 axis dials, and the new cameras would pile up
    // clamped against a panel edge. Move the dials; do not weaken this test.
    expect(defaultOf('axisNightEdgeDeg')).toBeLessThanOrEqual(POOL_ALTITUDE_COVERAGE_DEG.min);
    expect(defaultOf('axisDayEdgeDeg')).toBeGreaterThanOrEqual(POOL_ALTITUDE_COVERAGE_DEG.max);
  });

  it('reads the coverage constant, not the sweep radius', async () => {
    // Guards the §8 contract textually: the display must not assume the
    // window equals TERMINATOR_SUN_ALTITUDE_DEG +/- SEARCH_RADIUS_DEG.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('app/components/mosaic/v3/engine/axis.ts', 'utf8');
    expect(src).not.toContain('SEARCH_RADIUS_DEG');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/engine/axis.test.ts`
Expected: FAIL — cannot resolve `./axis`, and `POOL_ALTITUDE_COVERAGE_DEG` is not exported.

- [ ] **Step 3: Add the coverage constant**

In `app/lib/masterConfig.ts`, immediately after the `TERMINATOR_WIDEN_OFFSETS_DEG` block, add:

```ts
// The solar-altitude range the terminator sweep actually gathers, as the
// UNION of every ring swept. This is the one contract between the pool and
// the display: a camera the sweep found must have somewhere on the panel to
// be, and `app/components/mosaic/v3/engine/axis.test.ts` asserts the mosaic's
// display window covers this range.
//
// Today only the base ring sweeps unconditionally, so the union is the base
// ring alone: -24 to -2. The escalation rings in TERMINATOR_WIDEN_OFFSETS_DEG
// only fire under TERMINATOR_CAMERA_FLOOR and are NOT counted here. The
// pool-coverage plan owns widening this value alongside the rings it turns
// on; widening it without moving the v3 axis dials is exactly what that test
// exists to catch.
export const POOL_ALTITUDE_COVERAGE_DEG = {
  min: TERMINATOR_SUN_ALTITUDE_DEG - SEARCH_RADIUS_DEG,
  max: TERMINATOR_SUN_ALTITUDE_DEG + SEARCH_RADIUS_DEG,
} as const;
```

- [ ] **Step 4: Write `axis.ts`**

Create `app/components/mosaic/v3/engine/axis.ts`:

```ts
import type { SizedTile } from './types';

/**
 * The window that turns a sun altitude into a horizontal position.
 *
 * X is perpendicular angular distance from the terminator, and that is
 * exactly solar altitude rather than an approximation: a point with the sun
 * h degrees up sits h degrees on the day side of the terminator circle.
 *
 * v2 derived this window from the cron's own constants. v3 makes it two
 * dials instead, because the window can usefully NARROW: good frames crowd
 * into the day-side third of the panel, and a tighter window spreads them
 * across it. The property the derived form bought — that the axis tracks
 * what the sweep gathers — is bought back by a test against
 * POOL_ALTITUDE_COVERAGE_DEG. Do not import the sweep radius here.
 */
export interface AxisConfig {
  /** Deepest twilight the panel shows. Altitudes below this clamp. */
  axisNightEdgeDeg: number;
  /** Shallowest twilight the panel shows. Altitudes above this clamp. */
  axisDayEdgeDeg: number;
}

/**
 * Solar altitude to a horizontal unit position, 0 = west edge, 1 = east.
 *
 * The sun sets in the west, so on the SUNSET feed a camera further east is
 * later in the day and its sun sits LOWER — west-to-east is altitude
 * high-to-low, and the mapping inverts. Sunrise is the mirror. This is what
 * keeps "west on the left, tiles travel left to right" true on both panels
 * while X still means depth into twilight (spec §3).
 */
export function altitudeToUnit(
  altDeg: number,
  cfg: AxisConfig,
  feed: 'sunrise' | 'sunset'
): number {
  const span = cfg.axisDayEdgeDeg - cfg.axisNightEdgeDeg;
  if (span <= 0) return 0.5;
  const raw = (altDeg - cfg.axisNightEdgeDeg) / span;
  const unit = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return feed === 'sunrise' ? unit : 1 - unit;
}

/**
 * A tile's absolute x. No packing, no de-overlap, no dependence on the pool:
 * the same altitude puts a tile of the same width in the same pixels tonight
 * and next year (spec §5.2).
 *
 * Scaling by (viewportWidth - width) rather than viewportWidth keeps the tile
 * inside the panel AND has the pleasant property that a tile's CENTRE lands
 * exactly on unit * viewportWidth — which is what lets the centre-line
 * overlay in `overlays/CentreLine.tsx` mark a real position rather than an
 * approximate one.
 *
 * A null altitude means the moment is unknown, not that the sun is at zero.
 * Centre is the honest answer; an edge would be a claim.
 */
export function tileX(
  tile: SizedTile,
  viewportWidth: number,
  cfg: AxisConfig,
  feed: 'sunrise' | 'sunset'
): number {
  const unit =
    tile.sunAltitudeDeg === null ? 0.5 : altitudeToUnit(tile.sunAltitudeDeg, cfg, feed);
  return unit * Math.max(0, viewportWidth - tile.width);
}
```

- [ ] **Step 5: Add the two dials so the boundary test has defaults to read**

In `app/components/mosaic/v3/settingsSchema.ts`, insert these two knobs into `V3_SETTINGS_SCHEMA` directly after the `latSouth` knob:

```ts
  {
    key: 'axisNightEdgeDeg', kind: 'number', min: -40, max: 0, step: 0.5, default: -24,
    label: 'night edge (deg)', section: 'arrangement',
    description: 'Solar altitude at the deep-twilight edge of the panel. Frames deeper than this clamp to the edge rather than widening the axis.',
  },
  {
    key: 'axisDayEdgeDeg', kind: 'number', min: -30, max: 20, step: 0.5, default: -2,
    label: 'day edge (deg)', section: 'arrangement',
    description: 'Solar altitude at the day-side edge of the panel. Narrowing the window spreads a pool that crowds into one third of the glass; widening it past what the sweep gathers just leaves dead space.',
  },
```

Do **not** wire them into `configFromSettings` yet — Task 6 rewrites that function wholesale, and an unused key in the schema is harmless (`mergeSettings` is schema-driven).

- [ ] **Step 6: Run the test**

Run: `npx vitest run app/components/mosaic/v3/engine/axis.test.ts`
Expected: PASS, all 12 assertions.

- [ ] **Step 7: Run the whole suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean. `app/lib/masterConfig.test.ts` may assert on the constants — read it; a new export should not disturb it.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/masterConfig.ts \
        app/components/mosaic/v3/engine/axis.ts \
        app/components/mosaic/v3/engine/axis.test.ts \
        app/components/mosaic/v3/settingsSchema.ts
git commit -m "feat(mosaic): v3 axis window as dials, with the pool-coverage contract"
```

---

### Task 3: Bands — a fixed vertical axis

Spec §5.1 and §5.2. The strip covering 45°N to 50°N is the same pixels tonight and next year, holding one camera or forty. Band assignment consults latitude and nothing else — never the pool.

The v2 copy already has a `bands.ts`, and `compose.ts` still imports `placeBands` from it. Rewriting the file now would break the build, so this task **adds** the new functions to the same file and leaves `placeBands` in place; Task 6 deletes `placeBands` when it deletes its caller.

**Files:**
- Modify: `app/components/mosaic/v3/engine/bands.ts`
- Create: `app/components/mosaic/v3/engine/bands.absolute.test.ts`

**Interfaces:**
- Consumes: `SizedTile` from `./types`.
- Produces:
  - `interface BandConfig { bandCount: number; latNorth: number; latSouth: number }`
  - `bandIndexForLat(lat: number, cfg: BandConfig): number`
  - `bandCenterY(index: number, viewportHeight: number, cfg: BandConfig): number`
  - `tileY(tile: SizedTile, viewportHeight: number, cfg: BandConfig): number`

- [ ] **Step 1: Write the failing test**

Create `app/components/mosaic/v3/engine/bands.absolute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bandIndexForLat, bandCenterY, tileY, type BandConfig } from './bands';
import type { SizedTile } from './types';

const cfg: BandConfig = { bandCount: 13, latNorth: 70, latSouth: -60 };

const sized = (over: Partial<SizedTile> = {}): SizedTile => ({
  id: 1, lat: 47.6, lng: -122.3, srcWidth: 400, srcHeight: 224,
  passes: true, score: 0.8, sunAltitudeDeg: -13,
  width: 200, height: 112, pinnedToFloor: false,
  ...over,
});

describe('bandIndexForLat', () => {
  it('is a pure function of latitude — the pool is not an argument', () => {
    // 13 bands across 70..-60 is exactly 10 degrees each. 47.6 is in the
    // strip 60..50 -> index 1? No: 70..60 is 0, 60..50 is 1, 50..40 is 2.
    expect(bandIndexForLat(47.6, cfg)).toBe(2);
    expect(bandIndexForLat(69.9, cfg)).toBe(0);
    expect(bandIndexForLat(-59.9, cfg)).toBe(12);
  });

  it('gives the same index for the same latitude every call', () => {
    expect(bandIndexForLat(12.5, cfg)).toBe(bandIndexForLat(12.5, cfg));
  });

  it('clamps latitudes outside the window into the end bands', () => {
    expect(bandIndexForLat(89, cfg)).toBe(0);
    expect(bandIndexForLat(-89, cfg)).toBe(12);
  });

  it('survives a degenerate window instead of returning NaN', () => {
    expect(bandIndexForLat(10, { bandCount: 8, latNorth: 0, latSouth: 0 })).toBe(0);
  });

  it('floors a fractional band count and never allows zero bands', () => {
    expect(bandIndexForLat(-59.9, { ...cfg, bandCount: 2.9 })).toBe(1);
    expect(bandIndexForLat(-59.9, { ...cfg, bandCount: 0 })).toBe(0);
  });
});

describe('bandCenterY', () => {
  it('places band centres on a fixed grid independent of contents', () => {
    const c: BandConfig = { bandCount: 4, latNorth: 70, latSouth: -60 };
    expect(bandCenterY(0, 2000, c)).toBe(250);
    expect(bandCenterY(1, 2000, c)).toBe(750);
    expect(bandCenterY(3, 2000, c)).toBe(1750);
  });
});

describe('tileY', () => {
  it('centres a tile on its band whatever its height', () => {
    const c: BandConfig = { bandCount: 4, latNorth: 70, latSouth: -60 };
    expect(tileY(sized({ lat: 65, height: 100 }), 2000, c)).toBe(200);
    expect(tileY(sized({ lat: 65, height: 400 }), 2000, c)).toBe(50);
  });

  it('lets a tall tile exceed its band rather than capping it', () => {
    const c: BandConfig = { bandCount: 8, latNorth: 70, latSouth: -60 };
    // Band height is 250px; a 600px tile overhangs on both sides. Bands stay
    // fixed BECAUSE the eviction pass tests two dimensions (spec 5.3).
    const y = tileY(sized({ lat: 65, height: 600 }), 2000, c);
    expect(y).toBeLessThan(bandCenterY(0, 2000, c));
    expect(y + 600).toBeGreaterThan(bandCenterY(0, 2000, c) + 125);
  });

  it('does not move a tile when another tile appears', () => {
    // The headline property, at the level of one function: tileY has no
    // parameter through which the rest of the pool could reach it.
    const c: BandConfig = { bandCount: 8, latNorth: 70, latSouth: -60 };
    const before = tileY(sized({ lat: 12 }), 2000, c);
    const after = tileY(sized({ lat: 12 }), 2000, c);
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/engine/bands.absolute.test.ts`
Expected: FAIL — `bandIndexForLat is not a function`.

- [ ] **Step 3: Add the three functions**

At the **top** of `app/components/mosaic/v3/engine/bands.ts`, above the existing `placeBands`, add:

```ts
/**
 * The band model (spec §5.1). The latitude window is cut into bandCount
 * equal strips that never move. A camera's band follows from its latitude
 * alone: the strip covering 45N to 50N is the same pixels tonight and next
 * year, holding one camera or forty.
 *
 * This is the vertical cure for the disease fixed on the horizontal axis on
 * 2026-09-01. v2 formed rows by greedy width packing over the current pool
 * and placed each row at its members' mean latitude, so adding one camera
 * changed row membership, which changed the means, which moved every row.
 *
 * An empty band stays empty. A quiet latitude reads as quiet.
 */
export interface BandConfig {
  bandCount: number;
  latNorth: number;
  latSouth: number;
}

const bandsOf = (cfg: BandConfig): number => Math.max(1, Math.floor(cfg.bandCount));

/** Which fixed strip a latitude falls in. North is band 0. */
export function bandIndexForLat(lat: number, cfg: BandConfig): number {
  const count = bandsOf(cfg);
  const span = cfg.latNorth - cfg.latSouth;
  if (span <= 0) return 0;
  const t = (cfg.latNorth - lat) / span;
  return Math.max(0, Math.min(count - 1, Math.floor(t * count)));
}

/** A band's vertical centre in px. Fixed for the life of the panel. */
export function bandCenterY(
  index: number,
  viewportHeight: number,
  cfg: BandConfig
): number {
  return ((index + 0.5) * viewportHeight) / bandsOf(cfg);
}

/**
 * A tile's absolute y: centred on its band, whatever its height.
 *
 * A tall tile is allowed to overhang its band. Capping tile height to the
 * band would make size mean "quality, unless you happen to be in a crowded
 * latitude", and size means quality and nothing else (spec §3). The overhang
 * is safe because the eviction pass tests rectangles in TWO dimensions
 * against the whole panel's admitted set, not just within the band.
 */
export function tileY(
  tile: SizedTile,
  viewportHeight: number,
  cfg: BandConfig
): number {
  return bandCenterY(bandIndexForLat(tile.lat, cfg), viewportHeight, cfg) - tile.height / 2;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run app/components/mosaic/v3/engine/bands.absolute.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean. The copied `bands.test.ts` still passes — `placeBands` is untouched.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3/engine/bands.ts \
        app/components/mosaic/v3/engine/bands.absolute.test.ts
git commit -m "feat(mosaic): v3 fixed latitude bands and absolute vertical placement"
```

---

### Task 4: Eviction — collisions resolved by quality, never by movement

Spec §5.3. Compute every candidate's rectangle at its absolute position, sort by quality descending, admit in order, skip anyone who intersects an already-admitted rectangle. Nothing is ever shoved. Hysteresis arrives in Task 5; this task ships the plain version with a `CompositionHistory` argument already threaded through so Task 5 is a change of one function body.

**Files:**
- Create: `app/components/mosaic/v3/engine/evict.ts`
- Create: `app/components/mosaic/v3/engine/evict.test.ts`

**Interfaces:**
- Consumes: `PlacedTile` from `./types`.
- Produces:
  - `interface CompositionHistory { admittedSince: ReadonlyMap<number, number>; now: number }`
  - `const EMPTY_HISTORY: CompositionHistory`
  - `interface EvictionConfig { tileGapPx: number; hysteresisMargin: number; minDwellMs: number }`
  - `baseQuality(t: PlacedTile): number`
  - `effectiveQuality(t: PlacedTile, history: CompositionHistory, cfg: EvictionConfig): number`
  - `overlaps(a: PlacedTile, b: PlacedTile, gap: number): boolean`
  - `admit(placed: PlacedTile[], history: CompositionHistory, cfg: EvictionConfig): { admitted: PlacedTile[]; evicted: number[] }`

- [ ] **Step 1: Write the failing test**

Create `app/components/mosaic/v3/engine/evict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { admit, baseQuality, overlaps, EMPTY_HISTORY, type EvictionConfig } from './evict';
import type { PlacedTile } from './types';

const cfg: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0, minDwellMs: 0 };

const at = (
  id: number, x: number, y: number, score: number | null,
  over: Partial<PlacedTile> = {}
): PlacedTile => ({
  id, lat: 0, lng: 0, srcWidth: 400, srcHeight: 224,
  passes: score !== null, score, sunAltitudeDeg: -13,
  width: 100, height: 100, pinnedToFloor: false, x, y,
  ...over,
});

describe('overlaps', () => {
  it('separates rectangles that clear each other by more than the gap', () => {
    expect(overlaps(at(1, 0, 0, 1), at(2, 110, 0, 1), 6)).toBe(false);
  });

  it('reports an intersection when the gap is not honoured', () => {
    expect(overlaps(at(1, 0, 0, 1), at(2, 104, 0, 1), 6)).toBe(true);
  });

  it('tests the VERTICAL axis too, not just the horizontal', () => {
    // Same x, stacked. A horizontal-only test would call this clear.
    expect(overlaps(at(1, 0, 0, 1), at(2, 0, 50, 1), 6)).toBe(true);
    expect(overlaps(at(1, 0, 0, 1), at(2, 0, 110, 1), 6)).toBe(false);
  });

  it('catches a tile taller than its band reaching into the next one', () => {
    const tall = at(1, 0, 0, 1, { height: 600 });
    const neighbour = at(2, 0, 400, 1);
    expect(overlaps(tall, neighbour, 6)).toBe(true);
  });
});

describe('baseQuality', () => {
  it('ranks every gate-failer below every passer', () => {
    expect(baseQuality(at(1, 0, 0, null))).toBeLessThan(baseQuality(at(2, 0, 0, 0)));
  });

  it('ranks a passer with no score with the failers, not at the top', () => {
    const unscored = at(1, 0, 0, null, { passes: true });
    expect(baseQuality(unscored)).toBe(-1);
  });
});

describe('admit', () => {
  it('admits everything when nothing collides', () => {
    const { admitted, evicted } = admit([at(1, 0, 0, 0.9), at(2, 300, 0, 0.2)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([1, 2]);
    expect(evicted).toEqual([]);
  });

  it('keeps the better sunset and evicts the worse one', () => {
    const { admitted, evicted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.9)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([2]);
    expect(evicted).toEqual([1]);
  });

  it('does NOT move the admitted tile to make room', () => {
    const { admitted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.9)], EMPTY_HISTORY, cfg);
    expect(admitted[0].x).toBe(20);
    expect(admitted[0].y).toBe(0);
  });

  it('lets one large tile evict several neighbours — it earned the space', () => {
    const big = at(1, 0, 0, 0.9, { width: 500, height: 500 });
    const { admitted, evicted } = admit(
      [big, at(2, 100, 100, 0.5), at(3, 300, 300, 0.4)],
      EMPTY_HISTORY, cfg
    );
    expect(admitted.map((t) => t.id)).toEqual([1]);
    expect(evicted.sort()).toEqual([2, 3]);
  });

  it('is deterministic and order-independent given the same inputs', () => {
    const pool = [at(1, 0, 0, 0.4), at(2, 20, 0, 0.9), at(3, 40, 0, 0.4), at(4, 500, 0, 0.1)];
    const a = admit(pool, EMPTY_HISTORY, cfg);
    const b = admit([...pool].reverse(), EMPTY_HISTORY, cfg);
    expect(a.admitted.map((t) => t.id)).toEqual(b.admitted.map((t) => t.id));
    expect([...a.evicted].sort()).toEqual([...b.evicted].sort());
  });

  it('breaks exact ties by id so equal scores do not churn between ticks', () => {
    const { admitted } = admit([at(7, 20, 0, 0.5), at(3, 0, 0, 0.5)], EMPTY_HISTORY, cfg);
    expect(admitted.map((t) => t.id)).toEqual([3]);
  });

  it('reports evictions rather than silently shrinking the pool', () => {
    const { admitted, evicted } = admit(
      [at(1, 0, 0, 0.9), at(2, 10, 0, 0.8), at(3, 20, 0, 0.7)],
      EMPTY_HISTORY, cfg
    );
    expect(admitted.length + evicted.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/engine/evict.test.ts`
Expected: FAIL — cannot resolve `./evict`.

- [ ] **Step 3: Write `evict.ts`**

Create `app/components/mosaic/v3/engine/evict.ts`:

```ts
import type { PlacedTile } from './types';

/**
 * What the previous composition admitted, and when.
 *
 * `compose()` is pure and must stay pure — no module state, no hook inside
 * the engine (spec §5.4). Memory across compositions is therefore an
 * ARGUMENT: the caller owns the map and the clock, and passes both in.
 *
 * `now` and the map's values share one clock. `index.tsx` uses Date.now().
 */
export interface CompositionHistory {
  /** webcamId -> the clock reading when the tile was first admitted. */
  admittedSince: ReadonlyMap<number, number>;
  /** The clock reading this composition is being computed at. */
  now: number;
}

/** A first composition has no incumbents: everyone competes on merit alone. */
export const EMPTY_HISTORY: CompositionHistory = { admittedSince: new Map(), now: 0 };

export interface EvictionConfig {
  tileGapPx: number;
  hysteresisMargin: number;
  minDwellMs: number;
}

/**
 * The quality a tile fights with, before incumbency.
 *
 * Gate-failers and unscored frames sit at -1, below every real passer's
 * [0,1] score, so a floor tile never displaces a sunset.
 */
export function baseQuality(t: PlacedTile): number {
  return t.passes && t.score !== null ? t.score : -1;
}

/**
 * Incumbency bonus: a tile already on screen competes with
 * quality + hysteresisMargin, so a challenger must beat it by that margin
 * rather than by a rounding error. Without this, two cameras with close
 * scores trade places on every poll (spec §5.4).
 */
export function effectiveQuality(
  t: PlacedTile,
  history: CompositionHistory,
  cfg: EvictionConfig
): number {
  return history.admittedSince.has(t.id)
    ? baseQuality(t) + cfg.hysteresisMargin
    : baseQuality(t);
}

/**
 * 2D intersection with each rectangle expanded by the gap.
 *
 * TWO dimensions, not one. A tall tile may exceed its band's height, and
 * testing both axes is what lets the bands stay fixed without capping tile
 * size (spec §5.3).
 */
export function overlaps(a: PlacedTile, b: PlacedTile, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * Resolve crowding by eviction, never by movement.
 *
 * v2's de-overlap pass pushed colliding tiles rightward and then slid the
 * whole row back, which meant one arriving camera could move every tile in
 * the row and corrupted the axis. That pass is DELETED in v3, not adjusted.
 * Here, absolute positions are preserved exactly and the loser is simply not
 * drawn.
 *
 * One ordered pass over the WHOLE panel, not per band: a tile overhanging
 * its band must be tested against its neighbour band's tiles too, and a
 * single global order removes any dependence on which band is visited first.
 *
 * O(n^2) on purpose. The pool is tens to a few hundred tiles and this runs a
 * handful of times per composition; an index would buy microseconds and cost
 * a class of bugs.
 */
export function admit(
  placed: PlacedTile[],
  history: CompositionHistory,
  cfg: EvictionConfig
): { admitted: PlacedTile[]; evicted: number[] } {
  const ordered = [...placed].sort((a, b) => {
    const aq = effectiveQuality(a, history, cfg);
    const bq = effectiveQuality(b, history, cfg);
    if (aq !== bq) return bq - aq;
    // Total order. Without the id tie-break, equal-scoring tiles would
    // reorder between ticks and the wall would churn for no reason.
    return a.id - b.id;
  });

  const admitted: PlacedTile[] = [];
  const evicted: number[] = [];
  for (const tile of ordered) {
    if (admitted.some((other) => overlaps(tile, other, cfg.tileGapPx))) evicted.push(tile.id);
    else admitted.push(tile);
  }
  return { admitted, evicted };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run app/components/mosaic/v3/engine/evict.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3/engine/evict.ts \
        app/components/mosaic/v3/engine/evict.test.ts
git commit -m "feat(mosaic): v3 resolves collisions by evicting on quality, not by moving"
```

---

### Task 5: Hysteresis — near-ties do not trade places

Spec §5.4. Two mechanisms, **both required**: the incumbency bonus (already in `effectiveQuality` from Task 4) and a minimum dwell that makes a recently-admitted tile unevictable. Defaults are a starting guess, not a measurement.

**Files:**
- Modify: `app/components/mosaic/v3/engine/evict.ts`
- Modify: `app/components/mosaic/v3/engine/evict.test.ts`

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces: `protectedByDwell(t: PlacedTile, history: CompositionHistory, cfg: EvictionConfig): boolean`, exported. `admit`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/mosaic/v3/engine/evict.test.ts`:

```ts
import { protectedByDwell } from './evict';

describe('hysteresis — the incumbency bonus', () => {
  const withMargin: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0.05, minDwellMs: 0 };
  const incumbentIsTile1: CompositionHistory = {
    admittedSince: new Map([[1, 0]]),
    now: 10_000_000,
  };

  it('keeps the incumbent when the challenger is inside the margin', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.53)],
      incumbentIsTile1,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([1]);
  });

  it('lets the challenger through once it beats the margin', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.58)],
      incumbentIsTile1,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });

  it('gives no bonus to a tile that was not on screen', () => {
    const { admitted } = admit(
      [at(1, 0, 0, 0.50), at(2, 20, 0, 0.53)],
      EMPTY_HISTORY,
      withMargin
    );
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });
});

describe('hysteresis — the minimum dwell', () => {
  const withDwell: EvictionConfig = { tileGapPx: 6, hysteresisMargin: 0, minDwellMs: 90_000 };

  it('protects a tile that has been on screen for less than the dwell', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 31_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), fresh, withDwell)).toBe(true);
    const { admitted } = admit([at(1, 0, 0, 0.1), at(2, 20, 0, 0.9)], fresh, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([1]);
  });

  it('releases the protection once the dwell has elapsed', () => {
    const settled: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 200_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), settled, withDwell)).toBe(false);
    const { admitted } = admit([at(1, 0, 0, 0.1), at(2, 20, 0, 0.9)], settled, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([2]);
  });

  it('never protects a tile that was not on screen at all', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 31_000 };
    expect(protectedByDwell(at(9, 0, 0, 0.9), fresh, withDwell)).toBe(false);
  });

  it('resolves a fight between two protected tiles by quality, deterministically', () => {
    const both: CompositionHistory = {
      admittedSince: new Map([[1, 1_000], [2, 1_000]]),
      now: 31_000,
    };
    const { admitted, evicted } = admit([at(1, 0, 0, 0.2), at(2, 20, 0, 0.8)], both, withDwell);
    expect(admitted.map((t) => t.id)).toEqual([2]);
    expect(evicted).toEqual([1]);
  });

  it('a dwell of zero protects nobody', () => {
    const fresh: CompositionHistory = { admittedSince: new Map([[1, 1_000]]), now: 1_000 };
    expect(protectedByDwell(at(1, 0, 0, 0.1), fresh, { ...withDwell, minDwellMs: 0 })).toBe(false);
  });
});
```

Add `type CompositionHistory` to the existing import from `./evict` at the top of the file.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/engine/evict.test.ts`
Expected: FAIL — `protectedByDwell` is not exported, and the dwell tests admit the wrong tile.

- [ ] **Step 3: Add the dwell rule**

In `app/components/mosaic/v3/engine/evict.ts`, add after `effectiveQuality`:

```ts
/**
 * Minimum dwell: a tile that has been on screen for less than minDwellMs is
 * not evicted at all, however good the challenger is.
 *
 * The incumbency bonus alone is not enough. It settles WHICH of two similar
 * tiles wins, but a genuinely better frame arriving every poll would still
 * flip the wall repeatedly. The dwell puts a floor on how often any one
 * position can change hands. Both mechanisms are required (spec §5.4).
 */
export function protectedByDwell(
  t: PlacedTile,
  history: CompositionHistory,
  cfg: EvictionConfig
): boolean {
  const since = history.admittedSince.get(t.id);
  return since !== undefined && history.now - since < cfg.minDwellMs;
}
```

and replace the sort comparator inside `admit` with:

```ts
  const ordered = [...placed].sort((a, b) => {
    // Dwell-protected incumbents are admitted first, so nothing can take
    // their space. Two protected tiles that collide still need a winner, and
    // they get one on quality — deterministically, like everyone else.
    const ap = protectedByDwell(a, history, cfg) ? 1 : 0;
    const bp = protectedByDwell(b, history, cfg) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aq = effectiveQuality(a, history, cfg);
    const bq = effectiveQuality(b, history, cfg);
    if (aq !== bq) return bq - aq;
    // Total order. Without the id tie-break, equal-scoring tiles would
    // reorder between ticks and the wall would churn for no reason.
    return a.id - b.id;
  });
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run app/components/mosaic/v3/engine/evict.test.ts`
Expected: PASS, including every Task 4 assertion (they use `minDwellMs: 0`, which protects nobody).

- [ ] **Step 5: Run the suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3/engine/evict.ts \
        app/components/mosaic/v3/engine/evict.test.ts
git commit -m "feat(mosaic): v3 hysteresis — incumbency bonus and minimum dwell"
```

---

### Task 6: Rewire `compose()` and delete the passes v3 replaces

The swap. `compose()` stops forming rows, stops relaxing them vertically and stops de-overlapping horizontally, and starts placing absolutely and admitting by quality. Band eviction and global overflow stay **separate stages** (spec §5.6): eviction runs first and handles crowding, then the existing uniform scale-down handles total vertical extent, and `dropped` still reports overflow casualties only.

**Files:**
- Modify: `app/components/mosaic/v3/engine/types.ts`
- Modify: `app/components/mosaic/v3/engine/compose.ts`
- Modify: `app/components/mosaic/v3/engine/bands.ts` (delete `placeBands`)
- Modify: `app/components/mosaic/v3/settingsSchema.ts`
- Modify: `app/components/mosaic/v3/engine/compose.test.ts`
- Modify: `app/components/mosaic/v3/settingsSchema.test.ts`
- Delete: `app/components/mosaic/v3/engine/rows.ts`, `rows.test.ts`, `verticalPlace.ts`, `verticalPlace.test.ts`, `horizontalPlace.ts`, `horizontalPlace.test.ts`, `bands.test.ts`

**Interfaces:**
- Consumes: `tileX`/`AxisConfig` (Task 2), `tileY`/`BandConfig` (Task 3), `admit`/`CompositionHistory`/`EMPTY_HISTORY`/`EvictionConfig` (Tasks 4-5), plus `sizeTiles`, `scaleTiles`, `MIN_COMPOSITION_SCALE`, `splitPool`, `applyPolicy`, `capTiles` unchanged from the v2 copy.
- Produces:
  - `V3Config` — v2's config minus `strategy`, `horizontalAnchor`, `rowAlign`, `geographicFidelity`; plus `axisNightEdgeDeg`, `axisDayEdgeDeg`, `hysteresisMargin`, `minDwellMs`, `showCentreLine`.
  - `Layout` gains `evicted: number[]`.
  - `compose(tiles, viewport, cfg, feed, peerTiles?, history?): Layout`
  - `selectCandidates(tiles, viewport, cfg, feed, history): TileInput[]`
  - `requiredScale(candidates, viewport, cfg, feed, history): number`

- [ ] **Step 1: Write the failing compose tests**

Replace the whole of `app/components/mosaic/v3/engine/compose.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import { EMPTY_HISTORY, type CompositionHistory } from './evict';
import type { TileInput, V3Config } from './types';

const cfg = (over: Partial<V3Config> = {}): V3Config => ({
  qualitySource: 'auto', gateThreshold: 0.55, failedCamPolicy: 'showAtFloor', maxTiles: 0,
  floorPx: 100, ceilingPx: 400, curve: 'linear',
  scoreFloor: 0, scoreCeiling: 1, sharedScale: true,
  bandCount: 8, tileGapPx: 6, latNorth: 70, latSouth: -60,
  axisNightEdgeDeg: -24, axisDayEdgeDeg: -2,
  hysteresisMargin: 0.05, minDwellMs: 90_000,
  showFeedLabel: true, showTileRatings: false, overlayScale: 1,
  showModelReadout: false, showCentreLine: false,
  ...over,
});

const tile = (
  id: number, lat: number, passes: boolean, score: number | null, alt = -13
): TileInput => ({
  id, lat, lng: id, srcWidth: 400, srcHeight: 224, passes, score, sunAltitudeDeg: alt,
});

const viewport = { width: 1080, height: 1920 };

describe('compose — basics', () => {
  it('returns an empty layout for an empty pool', () => {
    const layout = compose([], viewport, cfg(), 'sunset');
    expect(layout.tiles).toEqual([]);
    expect(layout.dropped).toEqual([]);
    expect(layout.evicted).toEqual([]);
    expect(layout.scale).toBe(1);
  });

  it('places tiles in distinct bands without either moving', () => {
    const layout = compose([tile(1, 65, true, 0.9), tile(2, -55, true, 0.9)], viewport, cfg(), 'sunset');
    expect(layout.tiles).toHaveLength(2);
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(1)!.y).toBeLessThan(byId.get(2)!.y);
  });

  it('keeps north above south', () => {
    const layout = compose([tile(1, -50, true, 0.5), tile(2, 60, true, 0.5)], viewport, cfg(), 'sunset');
    const byId = new Map(layout.tiles.map((t) => [t.id, t]));
    expect(byId.get(2)!.y).toBeLessThan(byId.get(1)!.y);
  });
});

describe('compose — the headline property: absolute placement', () => {
  const pool = [
    tile(1, 60, true, 0.9, -20),
    tile(2, 20, true, 0.8, -10),
    tile(3, -30, true, 0.7, -5),
  ];

  it('does not move any other tile when a camera arrives', () => {
    const before = compose(pool, viewport, cfg(), 'sunset');
    const after = compose([...pool, tile(4, 45, true, 0.6, -18)], viewport, cfg(), 'sunset');
    const beforeById = new Map(before.tiles.map((t) => [t.id, t]));
    for (const t of after.tiles) {
      const was = beforeById.get(t.id);
      if (!was) continue;
      expect({ id: t.id, x: t.x, y: t.y }).toEqual({ id: was.id, x: was.x, y: was.y });
    }
  });

  it('does not move any other tile when a camera leaves', () => {
    const before = compose(pool, viewport, cfg(), 'sunset');
    const after = compose(pool.slice(1), viewport, cfg(), 'sunset');
    const beforeById = new Map(before.tiles.map((t) => [t.id, t]));
    for (const t of after.tiles) {
      const was = beforeById.get(t.id)!;
      expect({ x: t.x, y: t.y }).toEqual({ x: was.x, y: was.y });
    }
  });

  it('puts the day side on the left for sunset and the right for sunrise', () => {
    const pair = [tile(1, 0, true, 0.9, -4), tile(2, 40, true, 0.9, -22)];
    const sunset = compose(pair, viewport, cfg(), 'sunset');
    const sunrise = compose(pair, viewport, cfg(), 'sunrise');
    const x = (l: typeof sunset, id: number) => l.tiles.find((t) => t.id === id)!.x;
    expect(x(sunset, 1)).toBeLessThan(x(sunset, 2));
    expect(x(sunrise, 1)).toBeGreaterThan(x(sunrise, 2));
  });
});

describe('compose — eviction and overflow are separate stages', () => {
  it('reports crowding as evicted, not as dropped', () => {
    const crowded = [
      tile(1, 60, true, 0.9, -13),
      tile(2, 60, true, 0.5, -13),
      tile(3, 60, true, 0.4, -13),
    ];
    const layout = compose(crowded, viewport, cfg(), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
    expect(layout.evicted.sort()).toEqual([2, 3]);
    expect(layout.dropped).toEqual([]);
  });

  it('does not report policy-hidden tiles as dropped or evicted', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, false, 0.1)];
    const layout = compose(pool, viewport, cfg({ failedCamPolicy: 'hide' }), 'sunset');
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
    expect(layout.dropped).toEqual([]);
    expect(layout.evicted).toEqual([]);
  });

  it('shrinks uniformly before dropping anything', () => {
    // One band, tall tiles: the composition must scale rather than cull.
    const pool = [tile(1, 60, true, 1, -20), tile(2, 60, true, 1, -5)];
    const layout = compose(
      pool, { width: 1080, height: 300 }, cfg({ bandCount: 1, floorPx: 400, ceilingPx: 400 }), 'sunset'
    );
    expect(layout.scale).toBeLessThan(1);
    expect(layout.dropped).toEqual([]);
  });
});

describe('compose — hysteresis reaches the composition', () => {
  const crowded = [tile(1, 60, true, 0.50, -13), tile(2, 60, true, 0.53, -13)];

  it('keeps the incumbent when the challenger is inside the margin', () => {
    const history: CompositionHistory = { admittedSince: new Map([[1, 0]]), now: 10_000_000 };
    const layout = compose(crowded, viewport, cfg(), 'sunset', [], history);
    expect(layout.tiles.map((t) => t.id)).toEqual([1]);
  });

  it('admits the better tile with no history', () => {
    const layout = compose(crowded, viewport, cfg(), 'sunset', [], EMPTY_HISTORY);
    expect(layout.tiles.map((t) => t.id)).toEqual([2]);
  });

  it('defaults to no history when the caller omits it', () => {
    expect(compose(crowded, viewport, cfg(), 'sunset').tiles.map((t) => t.id)).toEqual([2]);
  });
});

describe('compose — purity', () => {
  it('does not mutate its inputs', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, true, 0.4)];
    const snapshot = JSON.stringify(pool);
    compose(pool, viewport, cfg(), 'sunset');
    expect(JSON.stringify(pool)).toBe(snapshot);
  });

  it('returns the same layout for the same inputs', () => {
    const pool = [tile(1, 60, true, 0.9), tile(2, -50, true, 0.4)];
    const a = compose(pool, viewport, cfg(), 'sunset');
    const b = compose(pool, viewport, cfg(), 'sunset');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/engine/compose.test.ts`
Expected: FAIL — `V3Config` still has `strategy`, `Layout` has no `evicted`.

- [ ] **Step 3: Update `types.ts`**

In `app/components/mosaic/v3/engine/types.ts`:

Delete the `Row` and `PlacedRow` interfaces, and the `ArrangementStrategy`, `HorizontalAnchor` and `RowAlign` type aliases.

Replace `Layout` with:

```ts
export interface Layout {
  tiles: PlacedTile[];
  /**
   * Overflow casualties ONLY (spec §5.6). Tiles the operator's own visibility
   * policy removed were configured away, and tiles the band pass evicted lost
   * a fight — three different mechanisms, three different numbers, so the
   * setup overlay can say which one removed a camera.
   */
  dropped: number[];
  /** Band-eviction casualties: placed, outranked, not drawn. */
  evicted: number[];
  scale: number; // 1 = the composition fit without shrinking
  viewport: { width: number; height: number };
}
```

Replace the `V3Config` interface with:

```ts
/** Every v3 composition knob, resolved to concrete values. */
export interface V3Config {
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
  scoreFloor: number; // score that renders at floorPx (absolute curves only)
  scoreCeiling: number; // score that renders at ceilingPx (absolute curves only)
  sharedScale: boolean; // adopt one overflow scale across both feeds
  // arrangement — bands vertically, solar altitude horizontally, both absolute
  bandCount: number;
  tileGapPx: number;
  latNorth: number;
  latSouth: number;
  axisNightEdgeDeg: number;
  axisDayEdgeDeg: number;
  // eviction
  hysteresisMargin: number;
  minDwellMs: number;
  // overlays
  showFeedLabel: boolean;
  showTileRatings: boolean;
  overlayScale: number; // multiplier on readout text size
  showModelReadout: boolean;
  showCentreLine: boolean;
}
```

`V3Config` now structurally satisfies `AxisConfig`, `BandConfig` and `EvictionConfig`, so it can be passed to any of them directly.

- [ ] **Step 4: Rewrite `compose.ts`**

Replace the whole of `app/components/mosaic/v3/engine/compose.ts` with:

```ts
import { tileX } from './axis';
import { tileY } from './bands';
import { admit, EMPTY_HISTORY, type CompositionHistory } from './evict';
import { MIN_COMPOSITION_SCALE, scaleTiles } from './overflow';
import { sizeTiles } from './sizing';
import { applyPolicy, capTiles, splitPool } from './visibility';
import type { Layout, PlacedTile, SizedTile, TileInput, V3Config } from './types';

const MAX_SCALE_PASSES = 4;

interface Placement {
  tiles: PlacedTile[];
  evicted: number[];
  extent: number;
}

/**
 * Absolute placement, then eviction. No packing, no relaxing, no shoving:
 * every tile's x comes from its own solar altitude and its y from its own
 * latitude, and crowding is settled by leaving the loser undrawn (spec §5.2,
 * §5.3).
 *
 * `extent` is the unclamped vertical span of what was ADMITTED, which is what
 * the overflow stage scales against. Tiles are centred on fixed bands, so the
 * only way to overflow is for tall tiles in the end bands to overhang the
 * panel — a uniform shrink pulls them back in.
 */
function arrange(
  sized: SizedTile[],
  viewport: { width: number; height: number },
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): Placement {
  const placed: PlacedTile[] = sized.map((t) => ({
    ...t,
    x: tileX(t, viewport.width, cfg, feed),
    y: tileY(t, viewport.height, cfg),
  }));
  const { admitted, evicted } = admit(placed, history, cfg);
  if (admitted.length === 0) return { tiles: [], evicted, extent: 0 };
  const top = Math.min(...admitted.map((t) => t.y));
  const bottom = Math.max(...admitted.map((t) => t.y + t.height));
  return { tiles: admitted, evicted, extent: bottom - top };
}

/** Does this candidate set, sized and scaled, fit the panel height? */
function fits(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory,
  scale: number
): boolean {
  const sized = scaleTiles(sizeTiles(candidates, cfg), scale);
  return arrange(sized, viewport, cfg, feed, history).extent <= viewport.height;
}

/**
 * The visible candidate set for a pool: gate split, the operator's
 * failed-cam policy, then the hard tile cap. Pulled out of `compose` so the
 * peer feed can be run through exactly the same funnel when the two panels
 * share one scale.
 */
export function selectCandidates(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): TileInput[] {
  const { passers, failers } = splitPool(tiles);
  const candidates =
    cfg.failedCamPolicy === 'showIfRoom'
      ? [
          ...passers,
          ...failers.slice(
            0,
            largestFittingCount(passers, failers, viewport, cfg, feed, history, 1)
          ),
        ]
      : applyPolicy(passers, failers, cfg);
  return capTiles(candidates, cfg.maxTiles);
}

/**
 * Smallest uniform scale this candidate set needs to fit the panel: 1 when
 * it already fits, never below MIN_COMPOSITION_SCALE.
 *
 * The iterative step can exhaust its passes while still overflowing and
 * still above the floor — extent is not linear in scale, because gaps do not
 * scale and shrinking changes which tiles the eviction pass admits. Forcing
 * the floor in that case is what makes "nothing is dropped until scaling has
 * bottomed out" hold literally rather than approximately.
 */
export function requiredScale(
  candidates: TileInput[],
  viewport: { width: number; height: number },
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory
): number {
  let scale = 1;
  let extent = arrange(sizeTiles(candidates, cfg), viewport, cfg, feed, history).extent;

  for (let pass = 0; pass < MAX_SCALE_PASSES && extent > viewport.height; pass++) {
    const next = Math.max(MIN_COMPOSITION_SCALE, scale * (viewport.height / extent));
    if (next === scale) break;
    scale = next;
    extent = arrange(
      scaleTiles(sizeTiles(candidates, cfg), scale), viewport, cfg, feed, history
    ).extent;
  }

  return extent > viewport.height ? MIN_COMPOSITION_SCALE : scale;
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
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  history: CompositionHistory,
  scale: number
): number {
  let lo = 0;
  let hi = ordered.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits([...base, ...ordered.slice(0, mid)], viewport, cfg, feed, history, scale)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The full v3 pipeline: signal-derived flags in, placed pixels out. Pure —
 * no DOM, no Image, no clock. The memory hysteresis needs arrives as
 * `history`, which the caller owns (spec §5.4).
 *
 * Two removal mechanisms, kept apart on purpose (spec §5.6). Band eviction
 * runs inside `arrange` and handles crowding. The overflow stage then handles
 * total vertical extent, and NEVER culls arbitrarily: the composition shrinks
 * uniformly first, and only once it hits MIN_COMPOSITION_SCALE does it drop,
 * deterministically from the lowest-scoring gate-failers up.
 *
 * `peerTiles` is the OTHER feed's pool. With cfg.sharedScale on, both panels
 * adopt the tighter of the two scales, so a floor tile is the same number of
 * pixels on the sunrise screen as on the sunset screen. Surfaces that show
 * one panel alone omit it.
 */
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: V3Config,
  feed: 'sunrise' | 'sunset',
  peerTiles: TileInput[] = [],
  history: CompositionHistory = EMPTY_HISTORY
): Layout {
  if (tiles.length === 0) {
    return { tiles: [], dropped: [], evicted: [], scale: 1, viewport };
  }

  let candidates = selectCandidates(tiles, viewport, cfg, feed, history);
  const droppedIds = new Set<number>();

  let scale = requiredScale(candidates, viewport, cfg, feed, history);
  if (cfg.sharedScale && peerTiles.length > 0) {
    // The peer is the other feed, so it must be arranged as the other feed:
    // x depends on the direction, x decides collisions, and collisions decide
    // the extent this scale is derived from.
    const peerFeed = feed === 'sunrise' ? 'sunset' : 'sunrise';
    scale = Math.min(
      scale,
      requiredScale(
        selectCandidates(peerTiles, viewport, cfg, peerFeed, history),
        viewport, cfg, peerFeed, history
      )
    );
  }

  let sized = scaleTiles(sizeTiles(candidates, cfg), scale);
  let placement = arrange(sized, viewport, cfg, feed, history);

  // Last resort: still overflowing at the scale floor. Keep the longest
  // prefix that fits — candidates run passers-first, weakest failers last,
  // so this drops exactly the tiles that matter least, deterministically.
  if (placement.extent > viewport.height) {
    const keep = Math.max(
      1, largestFittingCount([], candidates, viewport, cfg, feed, history, scale)
    );
    for (const t of candidates.slice(keep)) droppedIds.add(t.id);
    candidates = candidates.slice(0, keep);
    sized = scaleTiles(sizeTiles(candidates, cfg), scale);
    placement = arrange(sized, viewport, cfg, feed, history);
  }

  return {
    tiles: placement.tiles,
    dropped: [...droppedIds],
    evicted: placement.evicted,
    scale,
    viewport,
  };
}
```

- [ ] **Step 5: Delete the replaced passes**

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
git rm app/components/mosaic/v3/engine/rows.ts \
       app/components/mosaic/v3/engine/rows.test.ts \
       app/components/mosaic/v3/engine/verticalPlace.ts \
       app/components/mosaic/v3/engine/verticalPlace.test.ts \
       app/components/mosaic/v3/engine/horizontalPlace.ts \
       app/components/mosaic/v3/engine/horizontalPlace.test.ts \
       app/components/mosaic/v3/engine/bands.test.ts
```

Then open `app/components/mosaic/v3/engine/bands.ts` and delete the `placeBands` function and its `formRows` / `PlacedRow` / `V3Config` imports, leaving only the `BandConfig` block from Task 3 and its `import type { SizedTile } from './types';`.

- [ ] **Step 6: Swap the settings schema**

In `app/components/mosaic/v3/settingsSchema.ts`:

Delete the `strategy`, `horizontalAnchor`, `rowAlign` and `geographicFidelity` knobs — v3 has exactly one arrangement and they would be inert dials.

Change the `bandCount` knob to (note the widened range and new default; 13 bands over the 130-degree window is 10 degrees each):

```ts
  {
    key: 'bandCount', kind: 'number', min: 2, max: 40, step: 1, default: 13,
    label: 'band count', section: 'arrangement',
    description: 'Number of fixed latitude strips. They never move: a band is the same pixels holding one camera or forty. 13 over the default window is one band per 10 degrees.',
  },
```

Add two eviction knobs after `axisDayEdgeDeg`:

```ts
  {
    key: 'hysteresisMargin', kind: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05,
    label: 'incumbency margin', section: 'arrangement',
    description: 'How much better a challenger must score to take an on-screen tile\'s space. 0 lets near-ties trade places on every poll. A starting guess, not a measurement.',
  },
  {
    key: 'minDwellMs', kind: 'number', min: 0, max: 600_000, step: 5_000, default: 90_000,
    label: 'minimum dwell (ms)', section: 'arrangement',
    description: 'How long a newly admitted tile is safe from eviction, however good the challenger. The margin decides who wins a close fight; this decides how often any fight can happen. A starting guess, not a measurement.',
  },
```

Add the overlay knob after `showModelReadout`:

```ts
  {
    key: 'showCentreLine', kind: 'boolean', default: false,
    label: 'centre line', section: 'overlays',
    description: 'Marks where the pool\'s terminator ring falls on the axis — the organising idea of the whole composition, otherwise invisible. Studio only: the kiosk routes suppress it structurally, so leaving it on cannot put it on the glass.',
  },
```

Replace `configFromSettings` with:

```ts
/** Merged dial values to the engine's config shape. */
export function configFromSettings(values: SettingsValues): V3Config {
  return {
    qualitySource: values.qualitySource as V3Config['qualitySource'],
    gateThreshold: values.gateThreshold as number,
    failedCamPolicy: values.failedCamPolicy as V3Config['failedCamPolicy'],
    maxTiles: values.maxTiles as number,
    floorPx: values.floorPx as number,
    ceilingPx: values.ceilingPx as number,
    curve: values.curve as V3Config['curve'],
    scoreFloor: values.scoreFloor as number,
    scoreCeiling: values.scoreCeiling as number,
    sharedScale: values.sharedScale as boolean,
    bandCount: values.bandCount as number,
    tileGapPx: values.tileGapPx as number,
    latNorth: values.latNorth as number,
    latSouth: values.latSouth as number,
    axisNightEdgeDeg: values.axisNightEdgeDeg as number,
    axisDayEdgeDeg: values.axisDayEdgeDeg as number,
    hysteresisMargin: values.hysteresisMargin as number,
    minDwellMs: values.minDwellMs as number,
    showFeedLabel: values.showFeedLabel as boolean,
    showTileRatings: values.showTileRatings as boolean,
    overlayScale: values.overlayScale as number,
    showModelReadout: values.showModelReadout as boolean,
    showCentreLine: values.showCentreLine as boolean,
  };
}
```

- [ ] **Step 7: Fix the copied schema test**

Open `app/components/mosaic/v3/settingsSchema.test.ts`. Delete or rewrite any assertion naming `strategy`, `horizontalAnchor`, `rowAlign` or `geographicFidelity`. Add:

```ts
it('carries no dial the v3 engine cannot act on', () => {
  const dead = ['strategy', 'horizontalAnchor', 'rowAlign', 'geographicFidelity'];
  for (const key of dead) {
    expect(V3_SETTINGS_SCHEMA.find((k) => k.key === key)).toBeUndefined();
  }
});

it('maps every schema key into the engine config', () => {
  const cfg = configFromSettings(schemaDefaults(V3_SETTINGS_SCHEMA)) as Record<string, unknown>;
  const motionKeys = new Set([
    'motionMode', 'motionOrder', 'motionDurationMs', 'motionStaggerMs',
    'waveGridMs', 'crossfadeMs',
  ]);
  for (const knob of V3_SETTINGS_SCHEMA) {
    if (motionKeys.has(knob.key)) continue;
    expect(cfg[knob.key]).toBe(knob.default);
  }
});
```

Import `schemaDefaults` from `@/app/lib/settings/schema` at the top of that file if it is not already imported.

- [ ] **Step 8: Fix the remaining copied v3 tests**

`app/components/mosaic/v3/overlays/overlays.test.tsx` and `MosaicCanvas.test.tsx` build `Layout` objects; add `evicted: []` wherever they build one, and drop any `strategy`/`rowAlign` from their `cfg` helpers. Run the suite to find them:

Run: `npx vitest run app/components/mosaic/v3`
Expected: the failures name exactly which files need the two mechanical edits.

- [ ] **Step 9: Run the full suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean. v1 and v2 are untouched and must still pass.

- [ ] **Step 10: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3
git commit -m "feat(mosaic): v3 composes by absolute placement and eviction

Deletes row formation, vertical relax and horizontal de-overlap inside v3.
A tile's position now depends only on its own latitude and solar altitude,
so adding or removing a camera moves nothing else."
```

---

### Task 7: A real pool, and the property that justifies the whole design

Spec §9 asks for the headline invariance test on a real scene pool. The trustworthy one is the live capture — 21 sunrise, 42 sunset, scene id 3. Both reconstructed historical scenes sit roughly 7 hours off in local solar time and cannot judge anything twilight-dependent, so they are not usable here.

**Files:**
- Create: `scripts/export-scene-pool.mjs`
- Create: `app/components/mosaic/v3/engine/__fixtures__/live-capture-pool.json`
- Create: `app/components/mosaic/v3/engine/fixturePool.ts`
- Create: `app/components/mosaic/v3/engine/realPool.test.ts`

**Interfaces:**
- Consumes: `compose` (Task 6), `readSignal` from `../qualitySignal`, `sunAltitudeDeg` from `../solarPosition`.
- Produces:
  - `interface FixtureCam { webcamId: number; latitude: number; longitude: number; previewWidth: number; previewHeight: number; aiRatingBinary?: number; aiRatingRegression?: number; llmQuality?: number | null; llmIsSunset?: boolean | null }`
  - `interface FixturePool { label: string; representsAt: string; sunrise: FixtureCam[]; sunset: FixtureCam[] }`
  - `poolFrom(cams: FixtureCam[], representsAt: string, gateThreshold?: number): TileInput[]`

- [ ] **Step 1: Write the generator**

Create `scripts/export-scene-pool.mjs`:

```js
// scripts/export-scene-pool.mjs
// One-shot: freeze a kiosk_scenes row as a test fixture for the mosaic engine.
// Run: node scripts/export-scene-pool.mjs 3
// Writes app/components/mosaic/v3/engine/__fixtures__/live-capture-pool.json
import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sceneId = Number(process.argv[2] ?? 3);
const sql = neon(loadDatabaseUrl());
const [scene] = await sql`
  SELECT label, represents_at, state FROM kiosk_scenes WHERE id = ${sceneId}`;
if (!scene) throw new Error(`no scene ${sceneId}`);

// webcamId is a STRING in the stored payload and a number in WindyWebcam.
// Only the fields readSignal and the engine actually touch are kept: a
// fixture that carried whole Windy records would be 40x larger and would
// churn on unrelated schema changes.
const trim = (w) => ({
  webcamId: Number(w.webcamId),
  latitude: w.location.latitude,
  longitude: w.location.longitude,
  previewWidth: w.images?.sizes?.preview?.width ?? 400,
  previewHeight: w.images?.sizes?.preview?.height ?? 224,
  aiRatingBinary: w.aiRatingBinary,
  aiRatingRegression: w.aiRatingRegression,
  llmQuality: w.llmQuality,
  llmIsSunset: w.llmIsSunset,
});

const out = {
  label: scene.label,
  representsAt: new Date(scene.represents_at).toISOString(),
  sunrise: (scene.state.sunrise ?? []).map(trim),
  sunset: (scene.state.sunset ?? []).map(trim),
};

const dir = 'app/components/mosaic/v3/engine/__fixtures__';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/live-capture-pool.json`, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.sunrise.length} sunrise / ${out.sunset.length} sunset`);
```

- [ ] **Step 2: Generate the fixture**

Run: `node scripts/export-scene-pool.mjs 3`
Expected: `wrote 21 sunrise / 42 sunset`

If the database is unreachable, stop and say so rather than hand-writing a pool — the point of this task is that the property holds on real data.

- [ ] **Step 3: Write the fixture helper**

Create `app/components/mosaic/v3/engine/fixturePool.ts`:

```ts
import type { WindyWebcam } from '@/app/lib/types';
import { readSignal } from '../qualitySignal';
import { sunAltitudeDeg } from '../solarPosition';
import type { TileInput } from './types';

/** One camera as frozen by `scripts/export-scene-pool.mjs`. */
export interface FixtureCam {
  webcamId: number;
  latitude: number;
  longitude: number;
  previewWidth: number;
  previewHeight: number;
  aiRatingBinary?: number;
  aiRatingRegression?: number;
  llmQuality?: number | null;
  llmIsSunset?: boolean | null;
}

export interface FixturePool {
  label: string;
  representsAt: string;
  sunrise: FixtureCam[];
  sunset: FixtureCam[];
}

/**
 * Fixture rows to engine inputs, through the REAL signal and solar-position
 * code rather than a second copy of the rules. `useLoadedTiles` does exactly
 * this at runtime; the only thing the fixture stands in for is the image
 * load, whose only contribution is the natural size.
 *
 * The cast is narrow and deliberate: readSignal reads four optional score
 * fields and nothing else, so a full WindyWebcam would be dead weight in the
 * fixture and one more thing to keep in sync.
 */
export function poolFrom(
  cams: FixtureCam[],
  representsAt: string,
  gateThreshold = 0.55
): TileInput[] {
  const moment = new Date(representsAt);
  return cams.map((c) => {
    const { passes, score } = readSignal(
      c as unknown as WindyWebcam, 'auto', gateThreshold
    );
    return {
      id: c.webcamId,
      lat: c.latitude,
      lng: c.longitude,
      srcWidth: c.previewWidth,
      srcHeight: c.previewHeight,
      passes,
      score,
      sunAltitudeDeg: sunAltitudeDeg(moment, c.latitude, c.longitude),
    };
  });
}
```

- [ ] **Step 4: Write the failing property test**

Create `app/components/mosaic/v3/engine/realPool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import { poolFrom, type FixturePool } from './fixturePool';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { V3_SETTINGS_SCHEMA, configFromSettings } from '../settingsSchema';
import fixture from './__fixtures__/live-capture-pool.json';

const pool = fixture as FixturePool;
const cfg = configFromSettings(schemaDefaults(V3_SETTINGS_SCHEMA));
const viewport = { width: 1080, height: 1920 };

const sunset = poolFrom(pool.sunset, pool.representsAt);
const sunrise = poolFrom(pool.sunrise, pool.representsAt);

const posOf = (tiles: { id: number; x: number; y: number }[]) =>
  new Map(tiles.map((t) => [t.id, `${t.x},${t.y}`]));

describe('the live capture pool', () => {
  it('is the scene this test claims to use', () => {
    expect(pool.sunrise).toHaveLength(21);
    expect(pool.sunset).toHaveLength(42);
  });

  it('composes without dropping the whole pool', () => {
    const layout = compose(sunset, viewport, cfg, 'sunset', sunrise);
    expect(layout.tiles.length).toBeGreaterThan(0);
  });
});

describe('HEADLINE: adding or removing a camera moves no other tile', () => {
  it('holds when each camera in turn is removed from the sunset pool', () => {
    const full = compose(sunset, viewport, cfg, 'sunset');
    const before = posOf(full.tiles);

    for (let i = 0; i < sunset.length; i++) {
      const without = sunset.filter((_, j) => j !== i);
      const layout = compose(without, viewport, cfg, 'sunset');
      for (const t of layout.tiles) {
        const was = before.get(t.id);
        if (was === undefined) continue; // was evicted before, admitted now
        expect(`${t.id}: ${t.x},${t.y}`).toBe(`${t.id}: ${was}`);
      }
    }
  });

  it('holds when a camera arrives into the sunrise pool', () => {
    const base = sunrise.slice(0, sunrise.length - 1);
    const before = posOf(compose(base, viewport, cfg, 'sunrise').tiles);
    const after = compose(sunrise, viewport, cfg, 'sunrise').tiles;
    for (const t of after) {
      const was = before.get(t.id);
      if (was === undefined) continue;
      expect(`${t.id}: ${t.x},${t.y}`).toBe(`${t.id}: ${was}`);
    }
  });

  it('holds for the panel scale too — one camera does not rescale the wall', () => {
    const full = compose(sunset, viewport, cfg, 'sunset').scale;
    const without = compose(sunset.slice(1), viewport, cfg, 'sunset').scale;
    expect(without).toBe(full);
  });
});

describe('the real pool, on the real axis', () => {
  it('accounts for every candidate: drawn, evicted, or configured away', () => {
    const layout = compose(sunset, viewport, cfg, 'sunset');
    const seen = new Set([
      ...layout.tiles.map((t) => t.id),
      ...layout.evicted,
      ...layout.dropped,
    ]);
    // Default policy is showAtFloor, so nothing is configured away.
    expect(seen.size).toBe(sunset.length);
  });

  it('draws no two tiles overlapping', () => {
    const { tiles } = compose(sunset, viewport, cfg, 'sunset');
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i];
        const b = tiles[j];
        const clear =
          a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(`${a.id} vs ${b.id}: ${clear}`).toBe(`${a.id} vs ${b.id}: true`);
      }
    }
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run app/components/mosaic/v3/engine/realPool.test.ts`
Expected: PASS.

If the "holds for the panel scale too" case fails, the pool overflows and `requiredScale` is sensitive to membership. That is real and expected behaviour for a crowded pool, not a bug in placement — in that case change the assertion to compose at a viewport tall enough that `scale === 1` for both, and leave a comment saying the scale stage is pool-relative by design while placement is not.

- [ ] **Step 6: Run the suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add scripts/export-scene-pool.mjs \
        app/components/mosaic/v3/engine/__fixtures__/live-capture-pool.json \
        app/components/mosaic/v3/engine/fixturePool.ts \
        app/components/mosaic/v3/engine/realPool.test.ts
git commit -m "test(mosaic): prove v3 placement is pool-independent on the live capture scene"
```

---

### Task 8: Wire the history into the component, and report evictions

Spec §5.4 requires state across compositions; §5.6 requires the setup overlay to say which mechanism removed a camera. `compose()` stays pure — the map and the clock live in `index.tsx`.

**Files:**
- Modify: `app/components/mosaic/v3/index.tsx`
- Modify: `app/components/mosaic/v3/overlays/SetupOverlay.tsx`
- Modify: `app/components/mosaic/v3/index.test.tsx`
- Modify: `app/components/mosaic/v3/overlays/overlays.test.tsx`

**Interfaces:**
- Consumes: `compose` and `CompositionHistory` (Tasks 4-6).
- Produces: no new exports. `MosaicV3` now keeps an `admittedSince` map across renders.

- [ ] **Step 1: Write the failing overlay test**

In `app/components/mosaic/v3/overlays/overlays.test.tsx`, add to the SetupOverlay block:

```tsx
it('counts evictions separately from overflow drops', () => {
  render(
    <SetupOverlay
      layout={{
        tiles: [], dropped: [7], evicted: [8, 9], scale: 1,
        viewport: { width: 1080, height: 1920 },
      }}
      feed="sunset"
      skipped={2}
    />
  );
  const line = screen.getByTestId('v3-setup-counts').textContent ?? '';
  expect(line).toContain('dropped 1');
  expect(line).toContain('evicted 2');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/overlays/overlays.test.tsx`
Expected: FAIL — the counts line has no `evicted`.

- [ ] **Step 3: Add the counter**

In `app/components/mosaic/v3/overlays/SetupOverlay.tsx`, replace the counts line's contents with:

```tsx
        {feed} · tiles {layout.tiles.length} · evicted {layout.evicted.length} ·
        dropped {layout.dropped.length} · skipped {skipped} ·
        scale {layout.scale.toFixed(2)}
```

and extend that component's doc comment:

```tsx
/**
 * Installer aid: per-tile coordinates plus a composition health footer.
 *
 * Four different ways a camera can be missing, four numbers. `evicted` lost a
 * fight for its space to a better-scoring neighbour and is working as
 * designed; `dropped` means the composition could not fit even at the scale
 * floor and is the one that says the wall is struggling. Conflating them
 * would make an ordinary crowded band read as an overflow emergency.
 */
```

- [ ] **Step 4: Wire the history in `index.tsx`**

In `app/components/mosaic/v3/index.tsx`, add `useEffect` and `useRef` to the React import, then replace the `layout` memo with:

```tsx
  // Hysteresis needs memory across compositions, and `compose` is pure, so
  // the memory lives here: webcamId -> the clock reading at which the tile
  // was first admitted (spec §5.4).
  //
  // Read during the memo, written only in the effect below. Nothing here
  // re-triggers the memo, so there is no loop, and the dwell clock advances
  // exactly when a new composition is computed — which is the only moment an
  // eviction decision is ever made.
  const admittedSinceRef = useRef(new Map<number, number>());

  const layout = useMemo(
    () =>
      compose(tiles, { width, height }, cfg, feed, peerTiles, {
        admittedSince: admittedSinceRef.current,
        now: Date.now(),
      }),
    [tiles, peerTiles, width, height, cfg, feed]
  );

  useEffect(() => {
    const now = Date.now();
    const live = new Set(layout.tiles.map((t) => t.id));
    // Stamp arrivals; forget anything no longer drawn, so a tile that leaves
    // and comes back competes as a challenger rather than as an incumbent.
    for (const id of live) {
      if (!admittedSinceRef.current.has(id)) admittedSinceRef.current.set(id, now);
    }
    for (const id of [...admittedSinceRef.current.keys()]) {
      if (!live.has(id)) admittedSinceRef.current.delete(id);
    }
  }, [layout]);
```

- [ ] **Step 5: Write the failing component test**

Append to `app/components/mosaic/v3/index.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { compose } from './engine/compose';

vi.mock('./engine/compose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine/compose')>();
  return { ...actual, compose: vi.fn(actual.compose) };
});

describe('v3 hands the engine a history instead of holding state inside it', () => {
  it('passes an admittedSince map and a clock reading on every composition', () => {
    render(
      <MosaicV3 webcams={[]} width={1080} height={1920} feed="sunset" settings={{}} />
    );
    const history = vi.mocked(compose).mock.calls.at(-1)?.[5];
    expect(history?.admittedSince).toBeInstanceOf(Map);
    expect(typeof history?.now).toBe('number');
  });
});
```

Add `vi` to the vitest import at the top of that file.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/components/mosaic/v3`
Expected: PASS.

- [ ] **Step 7: Confirm the motion layer already crossfades admissions and evictions**

Spec §5.5 wants entering and leaving to be crossfades, and PR #116's motion layer already fades exiting tracks out. Verify rather than reimplement:

Run: `npx vitest run app/components/mosaic/v3/motion.test.ts`
Expected: PASS, including the exiting-track cases. Add nothing here. If no test covers a track disappearing from the target set, add one asserting its opacity falls toward zero rather than the tile vanishing on the next frame.

- [ ] **Step 8: Run the suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v3
git commit -m "feat(mosaic): v3 carries admission history across compositions

compose() stays pure; the map and the clock live in the component. The setup
overlay now separates band evictions from overflow drops."
```

---

### Task 9: The centre line, structurally off on the glass

Spec §7. The terminator zone organises the whole composition and is currently invisible. A dial alone is not enough: Deploy copies settings rows to the kiosk, so a dial left on in studio would follow it to the wall. Following the `setupMode` precedent, the kiosk routes decide, and no settings row can override them.

**Files:**
- Create: `app/components/mosaic/v3/overlays/CentreLine.tsx`
- Modify: `app/components/mosaic/types.ts`
- Modify: `app/components/mosaic/v3/index.tsx`
- Modify: `app/kiosk/sunrise/page.tsx`, `app/kiosk/sunset/page.tsx`
- Modify: `app/components/mosaic/v3/overlays/overlays.test.tsx`
- Modify: `app/kiosk/sunrise/page.test.tsx`, `app/kiosk/sunset/page.test.tsx`

**Interfaces:**
- Consumes: `altitudeToUnit` and `AxisConfig` (Task 2), `TERMINATOR_SUN_ALTITUDE_DEG` from `@/app/lib/masterConfig`.
- Produces: `CentreLine({ cfg, feed, width, height }: { cfg: AxisConfig; feed: 'sunrise' | 'sunset'; width: number; height: number })`; `MosaicProps.allowDebugOverlays?: boolean`.

- [ ] **Step 1: Write the failing overlay test**

Append to `app/components/mosaic/v3/overlays/overlays.test.tsx`:

```tsx
import { CentreLine } from './CentreLine';

describe('CentreLine', () => {
  const cfg = { axisNightEdgeDeg: -24, axisDayEdgeDeg: -2 };

  it('marks the pool ring at the middle of the panel', () => {
    render(<CentreLine cfg={cfg} feed="sunset" width={1080} height={1920} />);
    const line = screen.getByTestId('v3-centre-line');
    expect(line).toHaveStyle({ left: '540px' });
  });

  it('follows the axis dials rather than assuming the middle', () => {
    // A window whose ring is not centred: -13 sits 3/4 of the way across.
    render(
      <CentreLine
        cfg={{ axisNightEdgeDeg: -16, axisDayEdgeDeg: -4 }}
        feed="sunrise" width={1200} height={1920}
      />
    );
    expect(screen.getByTestId('v3-centre-line')).toHaveStyle({ left: '300px' });
  });

  it('names the altitude it is marking', () => {
    render(<CentreLine cfg={cfg} feed="sunset" width={1080} height={1920} />);
    expect(screen.getByTestId('v3-centre-line').textContent).toContain('-13');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/components/mosaic/v3/overlays/overlays.test.tsx`
Expected: FAIL — cannot resolve `./CentreLine`.

- [ ] **Step 3: Write the overlay**

Create `app/components/mosaic/v3/overlays/CentreLine.tsx`:

```tsx
import { TERMINATOR_SUN_ALTITUDE_DEG } from '@/app/lib/masterConfig';
import { altitudeToUnit, type AxisConfig } from '../engine/axis';

/**
 * The terminator zone made visible.
 *
 * Screen centre is the POOL's ring at TERMINATOR_SUN_ALTITUDE_DEG, not the
 * geometric terminator at 0 degrees — zero is outside the window today and
 * clamps (spec §3). The line is drawn where `tileX` puts a tile's centre for
 * that altitude, so it marks a real position rather than an approximate one.
 *
 * It follows the axis dials: narrowing the window moves the ring off the
 * middle of the glass, and a line hard-coded at 50% would then lie.
 */
export function CentreLine({
  cfg,
  feed,
  width,
  height,
}: {
  cfg: AxisConfig;
  feed: 'sunrise' | 'sunset';
  width: number;
  height: number;
}) {
  const left = altitudeToUnit(TERMINATOR_SUN_ALTITUDE_DEG, cfg, feed) * width;
  return (
    <div
      data-testid="v3-centre-line"
      style={{
        position: 'absolute',
        left,
        top: 0,
        height,
        width: 1,
        background: 'rgba(255,255,255,0.35)',
        pointerEvents: 'none',
        color: 'rgba(255,255,255,0.6)',
        fontFamily: 'monospace',
        fontSize: 11,
      }}
    >
      <span style={{ position: 'absolute', top: 6, left: 6, whiteSpace: 'nowrap' }}>
        {TERMINATOR_SUN_ALTITUDE_DEG}°
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Add the prop to the shared contract**

In `app/components/mosaic/types.ts`, add to `MosaicProps` after `setupMode`:

```ts
  /**
   * Whether this surface permits debugging overlays that must never reach the
   * glass. Defaults to true, and the KIOSK ROUTES pass false unless `?debug=1`
   * is present.
   *
   * A settings dial alone is not enough: Deploy copies settings rows to the
   * kiosk, so a dial left on in studio would follow it to the wall. Structural
   * suppression at the route, like `setupMode`, is what makes that impossible
   * while keeping the overlay reachable by hand on the device.
   */
  allowDebugOverlays?: boolean;
```

- [ ] **Step 5: Render it from v3**

In `app/components/mosaic/v3/index.tsx`, add `allowDebugOverlays = true` to the destructured props, import `CentreLine`, and add before the `setupMode` overlay:

```tsx
      {allowDebugOverlays && cfg.showCentreLine && (
        <CentreLine cfg={cfg} feed={feed} width={width} height={height} />
      )}
```

- [ ] **Step 6: Suppress it structurally on both kiosk routes**

In **both** `app/kiosk/sunset/page.tsx` and `app/kiosk/sunrise/page.tsx`, add to the `<Mosaic ...>` element, directly under `setupMode`:

```tsx
        allowDebugOverlays={searchParams.get('debug') === '1'}
```

Leave `app/studio/PreviewPane.tsx` alone: it omits the prop, so studio gets the default `true` and the dial works there.

- [ ] **Step 7: Write the failing route tests**

Both kiosk test files already mock `useSearchParams` through a `useSearchParamsMock` and read the rendered props through a `getMosaicProps()` helper. Reuse both.

Append inside the `describe('SunsetKioskPage', ...)` block of `app/kiosk/sunset/page.test.tsx`:

```tsx
  it('forbids debug overlays without ?debug=1, so no dial can put one on the glass', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    render(<SunsetKioskPage />);
    expect(getMosaicProps().allowDebugOverlays).toBe(false);
  });

  it('allows them with ?debug=1, so the device stays debuggable by hand', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('debug=1'));
    render(<SunsetKioskPage />);
    expect(getMosaicProps().allowDebugOverlays).toBe(true);
  });
```

Append the same two cases inside `describe('SunriseKioskPage', ...)` in `app/kiosk/sunrise/page.test.tsx`, with `SunriseKioskPage` in place of `SunsetKioskPage`.

- [ ] **Step 8: Write the failing "no settings row can put it on the glass" test**

Append to `app/components/mosaic/v3/index.test.tsx`:

```tsx
it('does not draw the centre line on a kiosk route even when the dial is on', () => {
  const { queryByTestId } = render(
    <MosaicV3
      webcams={[]} width={1080} height={1920} feed="sunset"
      settings={{ showCentreLine: true }}
      allowDebugOverlays={false}
    />
  );
  expect(queryByTestId('v3-centre-line')).toBeNull();
});

it('draws it in studio, where the dial is the only gate', () => {
  const { getByTestId } = render(
    <MosaicV3
      webcams={[]} width={1080} height={1920} feed="sunset"
      settings={{ showCentreLine: true }}
    />
  );
  expect(getByTestId('v3-centre-line')).toBeTruthy();
});
```

- [ ] **Step 9: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 10: Verify on the real page**

```bash
npm run dev
```

Open each of these and confirm by eye:

```
http://localhost:3000/kiosk/sunset?v=v3&panel=portrait
http://localhost:3000/kiosk/sunset?v=v3&panel=portrait&debug=1
http://localhost:3000/kiosk/sunset?v=v3&panel=portrait&setup=1
http://localhost:3000/studio
```

Expected: bands hold still as the pool refreshes; the day side of the sunset panel is on the LEFT; the centre line appears only with `debug=1` and the dial on; the setup overlay's footer shows an `evicted` count. Stop the dev server when done.

- [ ] **Step 11: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/types.ts \
        app/components/mosaic/v3 \
        app/kiosk/sunset/page.tsx app/kiosk/sunset/page.test.tsx \
        app/kiosk/sunrise/page.tsx app/kiosk/sunrise/page.test.tsx
git commit -m "feat(mosaic): draw the v3 centre line, suppressed structurally on the glass"
```

- [ ] **Step 12: Push the branch**

```bash
git rev-parse --abbrev-ref HEAD
git push -u origin feat/mosaic-v3-band-paradigm
```

---

## Finding after execution, corrected by measurement

**The band grid is a dial now (`bandGrid`: `full` | `inset`, default `full`,
plus a `?bandGrid=` URL override), so this can be settled on the glass. But
measuring it changed the conclusion, and the first version of this section
recommended the wrong fix.**

### The governing relation

`bandCount * ceilingPx <= panelHeight`. At 1080x1920 with the shipped
`ceilingPx` of 480, that caps `bandCount` at 4. The defaults ship
`13 * 480 = 6240`, which is 3.25x the panel height.

Break the relation and one of two things happens. Under `full`, a tall tile
in an end band overhangs, the overflow stage reads the overhang as overflow,
and the whole wall shrinks — measured at the `0.35` scale floor on the live
pool. Under `inset` the wall keeps full size, but the band pitch collapses
below the tile height (110px pitch against 240-383px tiles), tiles span three
or four bands each, and eviction throws most of the pool away.

**Both failure modes are the same arithmetic wearing different clothes.**

### Measured, sunset panel of the live capture, 4 of the 42 pass the gate

| bandGrid | bandCount | ceilingPx | product | real sunsets shown | tiles drawn | scale |
|---|---|---|---|---|---|---|
| full | 13 | 480 | 6240 | 1 of 4 | 5 | 1.00 |
| inset | 13 | 480 | 6240 | 1 of 4 | 3 | 1.00 |
| full | 4 | 480 | 1920 | 1 of 4 | 5 | 1.00 |
| full | 6 | 320 | 1920 | 2 of 4 | 5 | 1.00 |
| full | 8 | 240 | 1920 | 3 of 4 | 8 | 1.00 |
| full | 13 | 148 | 1924 | 3 of 4 | 11 | 1.00 |
| inset | 8 | 240 | 1920 | 3 of 4 | 8 | 1.00 |

### What this corrects

The earlier version of this section ranked "inset the band grid" first and
"turn the dials" last. That was backwards. Once the product is at or under the
panel height, `full` and `inset` produce **identical** results on this pool —
every `product = 1920` row above matches across both modes. The grid choice
only decides *which way* a bad dial combination fails, not whether the wall
works.

`inset` remains worth having as insurance: it guarantees `scale = 1` for any
dial combination, so a future ceiling or band change cannot silently pin the
composition against its floor. It is not the fix.

**The fix is the dials, and the shape of the trade is: more bands with a
smaller ceiling shows more of the pool, smaller.** `8 x 240` and `13 x 148`
both surface 3 of the 4 real sunsets instead of 1. Which one is right is a
question about the wall, so it stays Jesse's.

**Decided 2026-09-03: `8 x 240` ships as the v3 defaults.** Jesse's call,
from the side-by-side: the same 3 of 4 as `13 x 148`, but the ceiling stays
2.4x the floor so the best sunset is still visibly the best thing on the
wall. `realPool.test.ts` now pins 8 drawn / 34 evicted / 3 passers on the
sunset panel and 9 on sunrise.

### Compare them yourself

```
/kiosk/sunset?v=v3&panel=dell&setup=1&bandGrid=full
/kiosk/sunset?v=v3&panel=dell&setup=1&bandGrid=inset
```

`?panel=dell` matters — `portrait` is not a preset and is silently ignored,
which is how the first measurement in this section got taken against a 577px
browser window instead of the glass. The setup overlay's footer now ends with
`bands <count> <grid>` so a screenshot records which geometry produced it.

---

## Review outcome (2026-09-03)

`/code-review feat/mosaic-v3-band-paradigm high` ran six angles; two completed
and four were killed by a model session rate limit (line-by-line scan,
altitude-axis audit, removed-behaviour audit, and the orchestrator). What
landed was applied inline. The removed-behaviour audit is the one worth
re-running when the limit lifts: it would have checked that nothing in v3
still depends on the deleted row/relax/de-overlap passes. Manual check: no
dangling imports, suite and build green, but a fresh pass is cheap insurance.

**Applied, all confirmed before fixing:**

- **Centre line disagreed with tile centres off-midpoint** — by
  `tileWidth * (unit - 0.5)`, up to 50px at the window edges. `tileX` places a
  tile's left edge on a track `width - tileWidth` wide so tiles never leave
  the panel; the line marks the ring at `unit * width`. They coincide only at
  the midpoint. An earlier comment in `engine/axis.ts` claimed otherwise. The
  comments now state the real relationship and `axis.test.ts` pins it. The
  line was not moved: a per-tile line would need one line per tile width.
- **Stale test config literals were real type errors** — `sizing.test.ts` and
  `visibility.test.ts` still carried v2's `strategy`/`rowAlign` keys, a TS2353
  each, invisible inside the 185 pre-existing tsc errors and not checked by
  `next build`. Replaced by `engine/testConfig.ts`, which derives from the
  schema, so a new dial reaches every test the moment it is declared.
- **Fixture typing** — `FixtureCam` now extends a `SignalSource` Pick of
  WindyWebcam and `readSignal` accepts that Pick, so the `as unknown as`
  double cast is gone and renaming a score column is a compile error, not a
  fixture that silently reads as unscored.
- **`admit()` comparator** re-derived four Map lookups per comparison; keys
  are now computed once per tile. The cost comment also stopped calling the
  arrange() fan-out "a handful" — it is ~11 per composition, more under
  showIfRoom.
- **Fixture script** accepted only double-quoted `DATABASE_URL`; now uses the
  same regex as `label-audit.mjs` and `usage-report.mjs`. A shared
  `scripts/lib/db.mjs` for all five loaders is the right home and not this PR.

**Deferred, and why:** the efficiency angle found five real costs — the peer
pool loads every image just to learn aspect and score, previews re-download
each minute even when the URL is unchanged, crossfades key on image identity
so identical frames still fade, `sizeTiles` recomputes per scale pass, and the
draw loop allocates per rAF tick. Every one is inherited byte-for-byte from
v2 (`useLoadedTiles.ts`, `MosaicCanvas.tsx`, `motion.ts`). Fixing them in v3
alone is the "fix lands in one version" failure the reuse angle flagged;
fixing them in v2 is out of this spec's scope. They belong to whichever
version wins the glass, after the comparison — and the peer-pool one in
particular is the same `poolFrom` pattern `fixturePool.ts` already uses, so
it is a small change when its time comes.

**Noted, not a defect:** five v3 files are byte-identical to v2 and four more
differ only in renames. Spec §4 prescribes this. The registry comment says
retire a loser by deleting its folder; the duplication is the price of that.

---

## Follow-up shipped 2026-09-03: labelled, comparable, restorable configurations

Jesse asked for a way to keep the 1-of-4 and 3-of-4 walls side by side with
notes, and proposed a `v4` registry entry. Not done that way, on purpose: v3
and v4 would be byte-identical except two numbers in a settings file, the
registry's versions are different *engines*, and every eviction fix would land
twice. The 3-of-4 result is the same algorithm at `bandCount 8, ceilingPx 240`.

What shipped instead, built in a sibling clone at
`~/GitHub/the-sunset-webcam-map-v3` while the shared checkout was held:

- **Any v3 dial from the URL** (`urlOverrides` in `settingsSchema.ts`). URL
  beats profile beats default, the precedence `?models=` already had. Range
  and option checks stay with `sanitizeValues` so the store and the URL share
  one judge. The side-by-side is two windows:

  ```
  /kiosk/sunset?v=v3&panel=dell&setup=1&bandCount=13&ceilingPx=480
  /kiosk/sunset?v=v3&panel=dell&setup=1&bandCount=8&ceilingPx=240
  ```

- **Scenes finished as saved configurations.** `kiosk_scenes` had always
  stored `notes` and a `provenance` blob of every namespace's dial deviations;
  the save dialog hardcoded `notes: ''` and nothing ever read provenance back,
  so a scene was a screenshot of a pool. Now: the save dialog takes a note,
  the selected scene's note shows under the header, and a **restore dials**
  button applies the saved version and deviations. It is a button, not a side
  effect of selection — viewing a saved pool under the *current* dials is the
  A/B of one pool against two dial sets.
- **The restore says what it lost.** Schemas drift; `sanitizeValues` drops
  unknown keys silently by design. `applyNamespace` returns `droppedKeys()` and
  the report reads "restored v3 · 3 of 4 dials · not in this schema:
  retiredDial". A scene saved under an older schema is a partial restore and
  now looks like one.
- **Order matters in the restore:** namespaces first, `activeVersion` last,
  because `applyNamespace` replaces a namespace wholesale and would overwrite a
  version written a line earlier.

Not verified in a browser: `/studio` is owner-gated and the headless session
could not sign in. Twelve studio test files cover the button, the report, the
notes field, and the hook; Jesse's signed-in smoke is the remaining check.

---

## Out of scope — do not do these

Restating spec §10 so it survives contact with an implementer who has only this document:

- Moving `TERMINATOR_SUN_ALTITUDE_DEG` or widening the sweep. That is the sibling pool-coverage spec.
- The `captured_at` type migration. Investigated and closed in spec §2.
- Promoting v3 to `DEFAULT_MOSAIC_VERSION`. That is a decision for the glass after all three are compared.
- Refactoring shared code out of v1, v2 and v3.
- The reconstructed-scene timestamp skew (scenes 1 and 2 sit ~7 hours off in local solar time).
- The ripple / refresh-head paradigm from the 2026-09-02 motion handoff.
- Chasing the small-to-large-to-small arc.
