# Adaptive Terminator Widening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a kiosk feed runs short of cameras, have the cron automatically sweep additional terminator rings — day side first — within the same tick, and stop as soon as the pool recovers.

**Architecture:** A pure orchestrator (`terminatorSweep.ts`) owns the escalation decision and receives its ring builder, fetcher, and classifier as injected functions, so the whole policy is unit-testable with no network. `route.ts` shrinks to wiring. Separately, the Windy bounding-box builder gains latitude and longitude clamping, which recovers roughly 2 of 31 boxes that currently 400 and silently return nothing.

**Tech Stack:** TypeScript, Next.js App Router route handlers, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-adaptive-terminator-widening-design.md` — read it first; it carries the live measurements this plan argues from.

## Global Constraints

- **Branch:** `feat/adaptive-terminator-widening`. **Verify before every commit** with `git rev-parse --abbrev-ref HEAD`. Jesse merges PRs in parallel sessions and the branch can shift mid-task. If it is not that branch, STOP and report.
- **Never `git add -A` / `git add .`.** Other sessions share this checkout and have unrelated `ml/` artifacts untracked. Stage only the explicit paths each task names.
- **No worktrees.** Plain branches in the single main checkout (`CLAUDE.md`).
- **Windy API hard limits, verified live 2026-09-02** — the bounding box must satisfy all of these or the call 400s:
  - `northLat - southLat <= 22.5` at `zoom=4` (the span cap scales with zoom; `zoom < 4` is rejected outright)
  - `northLat <= 90`, `southLat >= -90`
  - `eastLon <= 180`, `westLon >= -180`
- **`SEARCH_RADIUS_DEG` may never exceed 11.25**, since the box span is `2 × radius`. Task 2 adds a guard test; do not remove it.
- **Ring offset sign:** `radius = 90 - (sunAltitude + offsetDeg)`, so **positive offset moves the ring toward day**. `+15.75` is golden hour, `-15.75` is deep night. Day side is always tried first.
- **No cron cadence change.** `vercel.json` stays at `*/15 * * * *`. Out of scope, deliberately.
- Run tests with `npm run test -- --run <path>`. Lint with `npm run lint`.
- Every new constant lives in `app/lib/masterConfig.ts`, never inline in a route.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/api/cron/update-cameras/lib/windyApi.ts` (modify) | Add `boundingBox()` with clamping; add `fetchCoordsCounted()` that reports attempt/failure counts |
| `app/api/cron/update-cameras/lib/windyApi.test.ts` (create) | Bounding-box clamping and failure-counting tests |
| `app/api/cron/update-cameras/lib/terminatorSweep.ts` (create) | Pure escalation policy: which feeds are under floor, which rings to sweep, in what order, under what budget |
| `app/api/cron/update-cameras/lib/terminatorSweep.test.ts` (create) | Escalation policy tests, fully stubbed |
| `app/lib/masterConfig.ts` (modify) | `SEARCH_RADIUS_DEG` 9 → 11; add `TERMINATOR_CAMERA_FLOOR`, `TERMINATOR_WIDEN_OFFSETS_DEG`; remove `TERMINATOR_RING_OFFSETS_DEG` |
| `app/lib/masterConfig.test.ts` (create) | Guard test for the Windy span cap |
| `app/api/cron/update-cameras/route.ts` (modify) | Replace the fixed multi-ring sweep block with a call into `sweepWithEscalation`; surface telemetry |

---

## Task 1: Clamp the Windy bounding box

Two boxes per sweep currently 400 and return nothing: one near the pole at some declinations, one near the antimeridian. `fetchWebcamsFor` swallows both as an empty array. Clamping recovers roughly 6% of coverage for free.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/windyApi.ts`
- Test: `app/api/cron/update-cameras/lib/windyApi.test.ts` (create)

**Interfaces:**
- Consumes: `Location` from `@/app/lib/types` (`{ lat: number; lng: number }`)
- Produces: `boundingBox(loc: Location, radiusDeg: number): BoundingBox` where `BoundingBox = { northLat: number; southLat: number; eastLon: number; westLon: number }`

- [ ] **Step 1: Write the failing test**

Create `app/api/cron/update-cameras/lib/windyApi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boundingBox } from './windyApi';

describe('boundingBox', () => {
  it('returns an unclamped box away from the edges', () => {
    expect(boundingBox({ lat: 45, lng: 10 }, 11)).toEqual({
      northLat: 56, southLat: 34, eastLon: 21, westLon: -1,
    });
  });

  it('clamps latitude at the north pole', () => {
    const box = boundingBox({ lat: 85, lng: 0 }, 11);
    expect(box.northLat).toBe(90);
    expect(box.southLat).toBe(74);
  });

  it('clamps latitude at the south pole', () => {
    const box = boundingBox({ lat: -85, lng: 0 }, 11);
    expect(box.southLat).toBe(-90);
    expect(box.northLat).toBe(-74);
  });

  it('clamps longitude at the antimeridian', () => {
    expect(boundingBox({ lat: 0, lng: 175 }, 11).eastLon).toBe(180);
    expect(boundingBox({ lat: 0, lng: -175 }, 11).westLon).toBe(-180);
  });

  it('never produces a span wider than the Windy zoom-4 cap', () => {
    for (const lat of [-90, -85, -45, 0, 45, 85, 90]) {
      const box = boundingBox({ lat, lng: 0 }, 11);
      expect(box.northLat - box.southLat).toBeLessThanOrEqual(22.5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/windyApi.test.ts`
Expected: FAIL — `boundingBox` is not exported from `./windyApi`.

- [ ] **Step 3: Write minimal implementation**

In `app/api/cron/update-cameras/lib/windyApi.ts`, add above `fetchWebcamsFor`:

```ts
export interface BoundingBox {
  northLat: number;
  southLat: number;
  eastLon: number;
  westLon: number;
}

/**
 * Query box for one ring point, clamped to the ranges Windy accepts.
 *
 * Verified live 2026-09-02: the clusters endpoint 400s on northLat > 90,
 * southLat < -90, eastLon > 180 or westLon < -180, and `fetchWebcamsFor`
 * turns that into a silent empty array. The ring genuinely reaches both
 * the pole and the antimeridian, so ~2 of 31 boxes per sweep were being
 * lost that way.
 *
 * Clamping shrinks the box rather than wrapping it, so a box straddling
 * the antimeridian loses the sliver on the far side. Splitting into two
 * boxes would recover it; not done here because that stretch is open
 * ocean and a shrunken box still beats a 400.
 */
export function boundingBox(loc: Location, radiusDeg: number): BoundingBox {
  return {
    northLat: Math.min(90, loc.lat + radiusDeg),
    southLat: Math.max(-90, loc.lat - radiusDeg),
    eastLon: Math.min(180, loc.lng + radiusDeg),
    westLon: Math.max(-180, loc.lng - radiusDeg),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/windyApi.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use it in the fetcher**

In `fetchWebcamsFor`, replace the inline URL arithmetic:

```ts
  const box = boundingBox(loc, SEARCH_RADIUS_DEG);
  const url = `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${
    box.northLat
  }&southLat=${box.southLat}&eastLon=${box.eastLon}&westLon=${
    box.westLon
  }&zoom=4&include=images&include=urls&include=player&include=location&include=categories`;
```

- [ ] **Step 6: Run the full cron lib suite**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/api/cron/update-cameras/lib/windyApi.ts \
        app/api/cron/update-cameras/lib/windyApi.test.ts
git commit -m "fix(cron): clamp the Windy bounding box to the ranges it accepts"
```

---

## Task 2: Widen the base search radius to 11

Free coverage: same call count, 22% more ground per call. The guard test is the durable part — it encodes the API cap that the old `// 12 doesn't work` comment only hinted at.

**Files:**
- Modify: `app/lib/masterConfig.ts:27-31`
- Test: `app/lib/masterConfig.test.ts` (create)

**Interfaces:**
- Produces: `SEARCH_RADIUS_DEG = 11`

- [ ] **Step 1: Write the failing test**

Create `app/lib/masterConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SEARCH_RADIUS_DEG } from './masterConfig';

// Verified live against the Windy clusters endpoint 2026-09-02:
//   {"message":"Maximal distance between north and south latitudes on the
//    zoom level 4, should be 22.5!","error":"Bad Request","statusCode":400}
// The box span is 2 x SEARCH_RADIUS_DEG, and zoom < 4 is rejected outright,
// so 11.25 is a hard ceiling, not a preference.
const WINDY_ZOOM4_MAX_LAT_SPAN_DEG = 22.5;

describe('SEARCH_RADIUS_DEG', () => {
  it('keeps the query box inside the Windy zoom-4 span cap', () => {
    expect(SEARCH_RADIUS_DEG * 2).toBeLessThanOrEqual(
      WINDY_ZOOM4_MAX_LAT_SPAN_DEG
    );
  });

  it('is widened to 11, the practical maximum', () => {
    expect(SEARCH_RADIUS_DEG).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/lib/masterConfig.test.ts`
Expected: FAIL on the second test — received 9, expected 11.

- [ ] **Step 3: Write minimal implementation**

In `app/lib/masterConfig.ts`, replace the `SEARCH_RADIUS_DEG` block:

```ts
// Search radius per Windy API call, in degrees. The query box spans
// 2 x this value, and Windy's clusters endpoint caps the north-south span
// at 22.5 degrees on zoom 4 (and rejects zoom < 4), so 11.25 is a hard
// ceiling. Verified live 2026-09-02; guarded by masterConfig.test.ts.
export const SEARCH_RADIUS_DEG = 11;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/lib/masterConfig.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the wider suite**

Run: `npm run test -- --run app/api/cron/ app/components/Map/`
Expected: PASS. `SimpleMap.tsx` and `searchRadiusCircles.ts` read this constant to draw the search circles; they scale off it and need no edit, but confirm nothing asserted the old 9.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts
git commit -m "feat(cron): widen the base search radius to 11, guarded by the API cap"
```

---

## Task 3: Count sweep attempts and failures

More calls means more of `fetchWebcamsFor`'s silent `return []`. The escalation logic needs to know how many boxes actually answered, or a quota wall looks identical to an empty ocean.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/windyApi.ts`
- Test: `app/api/cron/update-cameras/lib/windyApi.test.ts`

**Interfaces:**
- Consumes: `boundingBox` (Task 1); `fetchWebcamsInBatches(coords, batchSize, delay): Promise<WindyWebcam[][]>` (existing)
- Produces: `fetchCoordsCounted(coords: Location[], batchSize?: number, delayMs?: number): Promise<CoordFetchResult>` where `CoordFetchResult = { webcams: WindyWebcam[]; attempted: number; empty: number }`

- [ ] **Step 1: Write the failing test**

Append to `app/api/cron/update-cameras/lib/windyApi.test.ts`. Merge these imports into the two import statements already at the top of that file rather than adding duplicates — a second `from 'vitest'` import trips `import/no-duplicates`:

```ts
// top of file becomes:
//   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
//   import { boundingBox, fetchCoordsCounted } from './windyApi';

describe('fetchCoordsCounted', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Boxes centred on lng 99 answer with one webcam; everything else 400s.
      if (url.includes('westLon=88')) {
        return { ok: true, json: async () => [{ webcamId: 1, location: {} }] };
      }
      return { ok: false, status: 400, statusText: 'Bad Request' };
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports how many boxes were tried and how many came back empty', async () => {
    const res = await fetchCoordsCounted(
      [{ lat: 0, lng: 99 }, { lat: 0, lng: 5 }, { lat: 0, lng: 20 }],
      5,
      0
    );
    expect(res.attempted).toBe(3);
    expect(res.empty).toBe(2);
    expect(res.webcams).toHaveLength(1);
  });

  it('is a no-op on an empty coordinate list', async () => {
    const res = await fetchCoordsCounted([], 5, 0);
    expect(res).toEqual({ webcams: [], attempted: 0, empty: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/windyApi.test.ts`
Expected: FAIL — `fetchCoordsCounted` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/api/cron/update-cameras/lib/windyApi.ts`:

```ts
export interface CoordFetchResult {
  webcams: WindyWebcam[];
  /** Boxes we sent to Windy. */
  attempted: number;
  /**
   * Boxes that returned nothing. Conflates "no cameras there" with "the call
   * failed", because `fetchWebcamsFor` swallows non-OK responses. That
   * conflation is the point: a rising `empty` count against a flat camera
   * count is the signature of an API wall, which is the thing we need to be
   * able to see.
   */
  empty: number;
}

/**
 * Batched sweep over ring coordinates that reports coverage, not just
 * results. Wraps `fetchWebcamsInBatches` so rate limiting stays in one place.
 */
export async function fetchCoordsCounted(
  coords: Location[],
  batchSize = 5,
  delayMs = 1000
): Promise<CoordFetchResult> {
  if (coords.length === 0) return { webcams: [], attempted: 0, empty: 0 };
  const batches = await fetchWebcamsInBatches(coords, batchSize, delayMs);
  return {
    webcams: batches.flat(),
    attempted: coords.length,
    empty: batches.filter((b) => b.length === 0).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/windyApi.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/api/cron/update-cameras/lib/windyApi.ts \
        app/api/cron/update-cameras/lib/windyApi.test.ts
git commit -m "feat(cron): report attempted and empty box counts from a sweep"
```

---

## Task 4: The escalation policy

The heart of the feature, and deliberately pure. Every dependency arrives as a function argument so the policy is tested with no network, no clock, and no database.

**Two amendments to the code sketched below, folded back in from review. The
sketch is otherwise as shipped.**

1. **`RingTelemetry` also carries `newWebcamIds: number[]`**, populated from the
   same `byId` delta as `newWebcams` — record an id before inserting it, so the
   delta is against every *earlier* ring rather than against the current one.
   `newWebcams` stays as the cheap scalar. The ids are required, not a nicety:
   "Verification after merge" step 4 asks which ring each camera came from, and
   a bare count cannot answer that.
2. **The base ring is swept as `sweep(0, [...FEEDS])`, not `sweep(0, FEEDS)`.**
   `sweep` stores the array it is handed straight into the returned telemetry,
   so passing the module-level constant makes `telemetry.rings[0].feedsSwept`
   an alias of `FEEDS`; any caller that sorted or mutated the telemetry would
   permanently reorder `FEEDS` and flip escalation priority for the rest of the
   process. (`feedsBelowFloor` already returns a fresh array, so escalation
   rings were never affected.)

**Files:**
- Create: `app/api/cron/update-cameras/lib/terminatorSweep.ts`
- Test: `app/api/cron/update-cameras/lib/terminatorSweep.test.ts` (create)

**Interfaces:**
- Consumes: `Location`, `WindyWebcam` from `@/app/lib/types`; `CoordFetchResult` from `./windyApi` (Task 3)
- Produces:

```ts
export type Feed = 'sunrise' | 'sunset';
export interface RingCoords { sunriseCoords: Location[]; sunsetCoords: Location[] }
export interface RingTelemetry {
  offsetDeg: number;
  feedsSwept: Feed[];
  attempted: number;
  empty: number;
  newWebcams: number;
}
export interface SweepTelemetry {
  rings: RingTelemetry[];
  counts: Record<Feed, number>;
  escalations: number;
  budgetExhausted: boolean;
}
export interface SweepResult {
  webcams: WindyWebcam[];
  coords: RingCoords;
  telemetry: SweepTelemetry;
}
export function feedsBelowFloor(counts: Record<Feed, number>, floor: number): Feed[]
export async function sweepWithEscalation(opts: SweepOptions): Promise<SweepResult>
```

- [ ] **Step 1: Write the failing test**

Create `app/api/cron/update-cameras/lib/terminatorSweep.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { feedsBelowFloor, sweepWithEscalation } from './terminatorSweep';
import type { Location, WindyWebcam } from '@/app/lib/types';

const cam = (id: number, lat = 0): WindyWebcam =>
  ({ webcamId: id, location: { latitude: lat, longitude: 0 } } as WindyWebcam);

const ring = (offsetDeg: number) => ({
  sunriseCoords: [{ lat: offsetDeg, lng: 1 }] as Location[],
  sunsetCoords: [{ lat: offsetDeg, lng: 2 }] as Location[],
});

/** Hands back `perRing[offset]` cameras, and records which coords were asked for. */
function stubFetcher(perRing: Record<number, WindyWebcam[]>, seen: Location[][] = []) {
  return async (coords: Location[]) => {
    seen.push(coords);
    const offset = coords[0]?.lat ?? 0;
    const webcams = perRing[offset] ?? [];
    return { webcams, attempted: coords.length, empty: 0 };
  };
}

/** Splits on webcamId parity: odd ids are sunrise, even ids are sunset. */
const classify = (webcams: WindyWebcam[]) => ({
  sunrise: webcams.filter((w) => w.webcamId % 2 === 1),
  sunset: webcams.filter((w) => w.webcamId % 2 === 0),
});

describe('feedsBelowFloor', () => {
  it('names only the feeds under the floor', () => {
    expect(feedsBelowFloor({ sunrise: 4, sunset: 21 }, 15)).toEqual(['sunrise']);
  });
  it('is empty when both feeds are healthy', () => {
    expect(feedsBelowFloor({ sunrise: 30, sunset: 21 }, 15)).toEqual([]);
  });
  it('treats the floor itself as healthy', () => {
    expect(feedsBelowFloor({ sunrise: 15, sunset: 15 }, 15)).toEqual([]);
  });
  it('names both when both are thin', () => {
    expect(feedsBelowFloor({ sunrise: 1, sunset: 2 }, 15)).toEqual([
      'sunrise', 'sunset',
    ]);
  });
});

describe('sweepWithEscalation', () => {
  it('does not escalate when the base ring already clears the floor', async () => {
    const seen: Location[][] = [];
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1), cam(2), cam(3), cam(4)] }, seen),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.escalations).toBe(0);
    expect(res.telemetry.rings).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it('escalates to the day ring for the thin feed only', async () => {
    const seen: Location[][] = [];
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher(
        { 0: [cam(2), cam(4)], 15.75: [cam(1), cam(3)] },
        seen
      ),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.escalations).toBe(1);
    expect(res.telemetry.rings[1].offsetDeg).toBe(15.75);
    expect(res.telemetry.rings[1].feedsSwept).toEqual(['sunrise']);
    // Only the sunrise half of the day ring was requested.
    expect(seen[1]).toEqual([{ lat: 15.75, lng: 1 }]);
  });

  it('tries the day side before the night side', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.rings.map((r) => r.offsetDeg)).toEqual([
      0, 15.75, -15.75,
    ]);
  });

  it('stops escalating when the budget is gone', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75, -15.75],
      hasBudget: () => false,
    });
    expect(res.telemetry.rings).toHaveLength(1);
    expect(res.telemetry.budgetExhausted).toBe(true);
  });

  it('deduplicates cameras seen on more than one ring', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1)], 15.75: [cam(1), cam(3)] }),
      classify,
      floor: 3,
      offsets: [15.75],
      hasBudget: () => true,
    });
    expect(res.webcams.map((w) => w.webcamId).sort()).toEqual([1, 3]);
    expect(res.telemetry.rings[1].newWebcams).toBe(1);
  });

  it('unions coordinates across every ring it swept', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75],
      hasBudget: () => true,
    });
    expect(res.coords.sunriseCoords).toEqual([
      { lat: 0, lng: 1 }, { lat: 15.75, lng: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/terminatorSweep.test.ts`
Expected: FAIL — cannot resolve `./terminatorSweep`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/cron/update-cameras/lib/terminatorSweep.ts`:

```ts
import type { Location, WindyWebcam } from '@/app/lib/types';
import type { CoordFetchResult } from './windyApi';

export type Feed = 'sunrise' | 'sunset';

export interface RingCoords {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
}

export interface RingTelemetry {
  offsetDeg: number;
  feedsSwept: Feed[];
  attempted: number;
  empty: number;
  /** Cameras this ring contributed that no earlier ring had seen. */
  newWebcams: number;
}

export interface SweepTelemetry {
  rings: RingTelemetry[];
  counts: Record<Feed, number>;
  escalations: number;
  budgetExhausted: boolean;
}

export interface SweepResult {
  webcams: WindyWebcam[];
  coords: RingCoords;
  telemetry: SweepTelemetry;
}

export interface SweepOptions {
  buildRing: (offsetDeg: number) => RingCoords;
  fetchCoords: (coords: Location[]) => Promise<CoordFetchResult>;
  classify: (
    webcams: WindyWebcam[],
    sunriseCoords: Location[],
    sunsetCoords: Location[]
  ) => { sunrise: WindyWebcam[]; sunset: WindyWebcam[] };
  floor: number;
  offsets: readonly number[];
  hasBudget: () => boolean;
}

const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Feeds whose camera count is under the floor. Order is stable: sunrise first. */
export function feedsBelowFloor(
  counts: Record<Feed, number>,
  floor: number
): Feed[] {
  return FEEDS.filter((f) => counts[f] < floor);
}

/**
 * Sweep the terminator, widening within THIS tick while any feed is short.
 *
 * The escalation level is never stored. It is re-derived every tick from what
 * the sweep actually returned, so it relaxes on its own the moment the
 * terminator moves back over land. Cross-tick hysteresis was considered and
 * rejected: widening succeeds, the count rises past the high-water mark, the
 * next tick narrows, the count collapses, and it oscillates.
 *
 * Ring order matters. `offsets` is day-side first (positive offset shrinks the
 * ring radius, moving it toward the sun), because the day-side ring lands in
 * golden hour while the night-side one lands ~29 degrees below the horizon,
 * where frames get gated anyway. Measured 2026-09-02: the +15.75 ring returned
 * 100% cameras the base ring had never seen.
 *
 * Only the thin feed's half of an escalation ring is swept. The two feeds are
 * routinely short at different times (4 vs 21 the day this was written), so
 * this halves the cost of the common case.
 */
export async function sweepWithEscalation(
  opts: SweepOptions
): Promise<SweepResult> {
  const byId = new Map<number, WindyWebcam>();
  const sunriseCoords: Location[] = [];
  const sunsetCoords: Location[] = [];
  const rings: RingTelemetry[] = [];
  let budgetExhausted = false;

  const sweep = async (offsetDeg: number, feeds: Feed[]) => {
    const ring = opts.buildRing(offsetDeg);
    const coords: Location[] = [];
    if (feeds.includes('sunrise')) {
      sunriseCoords.push(...ring.sunriseCoords);
      coords.push(...ring.sunriseCoords);
    }
    if (feeds.includes('sunset')) {
      sunsetCoords.push(...ring.sunsetCoords);
      coords.push(...ring.sunsetCoords);
    }
    const before = byId.size;
    const res = await opts.fetchCoords(coords);
    for (const w of res.webcams) byId.set(w.webcamId, w);
    rings.push({
      offsetDeg,
      feedsSwept: feeds,
      attempted: res.attempted,
      empty: res.empty,
      newWebcams: byId.size - before,
    });
  };

  // Classify against the FULL coordinate set gathered so far, never against
  // the triggering feed alone. A day-side box on the sunrise half can hold a
  // camera that genuinely belongs to sunset, and forcing it into the feed that
  // triggered the sweep would corrupt the split.
  const currentCounts = (): Record<Feed, number> => {
    const split = opts.classify(
      [...byId.values()],
      sunriseCoords,
      sunsetCoords
    );
    return { sunrise: split.sunrise.length, sunset: split.sunset.length };
  };

  await sweep(0, FEEDS);
  let counts = currentCounts();

  for (const offsetDeg of opts.offsets) {
    const thin = feedsBelowFloor(counts, opts.floor);
    if (thin.length === 0) break;
    if (!opts.hasBudget()) {
      budgetExhausted = true;
      break;
    }
    await sweep(offsetDeg, thin);
    counts = currentCounts();
  }

  return {
    webcams: [...byId.values()],
    coords: { sunriseCoords, sunsetCoords },
    telemetry: {
      rings,
      counts,
      escalations: rings.length - 1,
      budgetExhausted,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/api/cron/update-cameras/lib/terminatorSweep.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/api/cron/update-cameras/lib/terminatorSweep.ts \
        app/api/cron/update-cameras/lib/terminatorSweep.test.ts
git commit -m "feat(cron): per-feed terminator widening, decided within the tick"
```

---

## Task 5: Add the tuning constants

**Files:**
- Modify: `app/lib/masterConfig.ts:33-35` (the `TERMINATOR_RING_OFFSETS_DEG` block)
- Test: `app/lib/masterConfig.test.ts`

**Interfaces:**
- Produces: `TERMINATOR_CAMERA_FLOOR = 15`, `TERMINATOR_WIDEN_OFFSETS_DEG = [15.75, -15.75]`

**Do NOT delete `TERMINATOR_RING_OFFSETS_DEG` in this task.** `route.ts:19`
imports it until Task 6 rewrites that block, so deleting it here leaves the
branch failing `tsc` at a committed checkpoint. Task 6 deletes it, where its
last reader disappears. Leave the old constant in place and add the new ones
beneath it.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/masterConfig.test.ts`:

```ts
import {
  TERMINATOR_CAMERA_FLOOR,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from './masterConfig';

describe('terminator widening constants', () => {
  it('starts the camera floor at 15 per feed', () => {
    expect(TERMINATOR_CAMERA_FLOOR).toBe(15);
  });

  it('tries the day side before the night side', () => {
    // Positive offset shrinks the ring radius, moving it toward the sun.
    expect(TERMINATOR_WIDEN_OFFSETS_DEG[0]).toBeGreaterThan(0);
    expect(TERMINATOR_WIDEN_OFFSETS_DEG).toEqual([15.75, -15.75]);
  });

  it('offsets the ring by more than a box width, or it re-finds the same cameras', () => {
    // Measured 2026-09-02: a 3-degree offset against an 18-degree box returned
    // only 26-35% new cameras; 15.75 returned 92-100%.
    for (const off of TERMINATOR_WIDEN_OFFSETS_DEG) {
      expect(Math.abs(off)).toBeGreaterThanOrEqual(SEARCH_RADIUS_DEG);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run app/lib/masterConfig.test.ts`
Expected: FAIL — the constants are not exported.

- [ ] **Step 3: Write minimal implementation**

In `app/lib/masterConfig.ts`, replace the whole `TERMINATOR_RING_OFFSETS_DEG` block:

```ts
// Per-feed camera count below which that feed sweeps an extra ring. Chosen
// against a single observation (4 sunrise, 21 sunset on 2026-09-02); expect
// to tune it once the sweep telemetry has a few days of history.
export const TERMINATOR_CAMERA_FLOOR = 15;

// Extra rings to sweep when a feed is under the floor, tried in this order.
// radius = 90 - (sunAltitude + offset), so POSITIVE MOVES TOWARD DAY: +15.75
// puts the ring near +2.75 degrees solar altitude (golden hour, which the base
// ring at -13 misses entirely), and -15.75 puts it near -28.75 (deep night,
// where the detection gate floors the frames anyway). Day side first.
//
// The magnitude is not arbitrary: the query box is 2 x SEARCH_RADIUS_DEG
// across, so an offset smaller than the box mostly re-finds the same cameras.
// Measured 2026-09-02 — a 3-degree offset returned 26-35% new cameras for a
// full ring's worth of API calls; 15.75 returned 92-100%.
export const TERMINATOR_WIDEN_OFFSETS_DEG = [15.75, -15.75] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run app/lib/masterConfig.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Take the map hook off the old constant**

Run: `grep -rn "TERMINATOR_RING_OFFSETS_DEG" app/ --include=*.ts --include=*.tsx`
Expected before this step: two readers — `app/api/cron/update-cameras/route.ts` (Task 6 handles it) and `app/components/Map/hooks/useUpdateTerminatorRing.ts` (this step). After this step, only `route.ts` should remain.

The map hook draws the ring the operator sees. In `useUpdateTerminatorRing.ts`, replace the `ringResults` memo:

```ts
  // One ring at offset 0. Escalation rings are a fetch-time concern that
  // varies tick to tick; drawing them would imply the map is showing cameras
  // from all of them. Do not import TERMINATOR_WIDEN_OFFSETS_DEG here.
  const ringResults = useMemo(() => {
    return [
      createTerminatorVisualizationRing(
        currentTime,
        raHours,
        gmstHours,
        precisionDeg,
        TERMINATOR_SUN_ALTITUDE_DEG,
        0,
      ),
    ];
  }, [currentTime, raHours, gmstHours, precisionDeg]);
```

`offsetRing` on the next line becomes `ringResults[1]`, i.e. `undefined`. That is already the runtime behaviour today, since `TERMINATOR_RING_OFFSETS_DEG` is `[0]` and the array has one entry, so every consumer of `offsetRing` already handles undefined. Leave those consumers alone. Then drop `TERMINATOR_RING_OFFSETS_DEG` from this file's `masterConfig` import.

- [ ] **Step 6: Run the map suite**

Run: `npm run test -- --run app/components/Map/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts \
        app/components/Map/hooks/useUpdateTerminatorRing.ts
git commit -m "feat(cron): add widening constants, retire the fixed offset ring list"
```

---

## Task 6: Wire the escalation into the cron

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts:75-115` (the ring + fetch block) and the final `NextResponse.json`
- Modify: `app/lib/masterConfig.ts` (add `TERMINATOR_SWEEP_BUDGET_MS`, delete `TERMINATOR_RING_OFFSETS_DEG`)

**Interfaces:**
- Consumes: `sweepWithEscalation`, `SweepTelemetry` (Task 4); `fetchCoordsCounted` (Task 3); `TERMINATOR_CAMERA_FLOOR`, `TERMINATOR_WIDEN_OFFSETS_DEG` (Task 5)
- Produces: `TERMINATOR_SWEEP_BUDGET_MS`; a `sweep: SweepTelemetry` field on the cron's JSON response

**The sweep budget is a named constant, not an inline expression.** An earlier
draft of this task wrote `hasBudget` as `Date.now() - tickStartedAt <
TICK_DEADLINE_MS / 2`. Review replaced it: `TICK_DEADLINE_MS / 2` is a tuning
number living inline in a route, which the Global Constraints forbid, and it
tied the sweep budget to the scoring deadline by arithmetic accident rather
than by decision — halving `TICK_DEADLINE_MS` would silently halve the sweep
budget too. It is now `TERMINATOR_SWEEP_BUDGET_MS = 25_000` in
`masterConfig.ts`, added by this task, and the two numbers are free to move
independently. The steps below reflect that.

Note that `hasBudget` is a **start-gate, not a deadline**: it is checked once
before each escalation ring and never during one, so a ring that starts just
under the budget runs to completion (roughly 5–7s for a half-ring). Accepted;
see the spec's Risks.

- [ ] **Step 1: Replace the sweep block**

In `route.ts`, replace everything from `// Generate terminator rings for all configured offsets` through `console.log('🗂️ Total unique webcams:', windyAll.length);` with:

```ts
  const sweep = await sweepWithEscalation({
    buildRing: (offsetDeg) => {
      const r = createTerminatorQueryRing(
        now,
        raHours,
        gmstHours,
        TERMINATOR_PRECISION_DEG,
        TERMINATOR_SUN_ALTITUDE_DEG,
        offsetDeg,
      );
      return {
        sunriseCoords: dedupeCoords(r.sunriseCoords),
        sunsetCoords: dedupeCoords(r.sunsetCoords),
      };
    },
    fetchCoords: (coords) =>
      fetchCoordsCounted(
        dedupeCoords(coords),
        WINDY_FETCH_BATCH_SIZE,
        WINDY_FETCH_DELAY_BETWEEN_BATCHES_MS,
      ),
    classify: classifyWebcamsByPhase,
    floor: TERMINATOR_CAMERA_FLOOR,
    offsets: TERMINATOR_WIDEN_OFFSETS_DEG,
    // Escalation rings are the first thing sacrificed on a slow tick: the
    // scoring loop below needs the remaining budget more than the pool needs
    // extra cameras. See TERMINATOR_SWEEP_BUDGET_MS for the cutoff rationale.
    hasBudget: () => Date.now() - tickStartedAt < TERMINATOR_SWEEP_BUDGET_MS,
  });

  const sunriseCoords = sweep.coords.sunriseCoords;
  const sunsetCoords = sweep.coords.sunsetCoords;
  const windyAll = sweep.webcams.filter((w) => w.location);

  console.log('🛰️ terminator sweep:', JSON.stringify(sweep.telemetry));
```

- [ ] **Step 2: Fix the imports and the `tickStartedAt` ordering**

Three edits, all verified against the current file rather than left as checks:

1. **`tickStartedAt` must move.** It is declared at `route.ts:141`, *after* the sweep block you just replaced at 75–116, so `hasBudget` would hit a temporal-dead-zone `ReferenceError`. Move `const tickStartedAt = Date.now();` up so it sits immediately above the `sweepWithEscalation` call, and delete the old line 141 declaration.
2. **`dedupeWebcams` is now unused.** Its only reader was line 115, which the replacement deleted. Remove it from the `./lib/windyApi` import or lint fails. `fetchWebcamsInBatches` is not imported by `route.ts` at all — leave it exported from `windyApi.ts`, since `fetchCoordsCounted` wraps it.
3. **Swap the constants.** Remove `TERMINATOR_RING_OFFSETS_DEG` from the `masterConfig` import, add `TERMINATOR_CAMERA_FLOOR`, `TERMINATOR_WIDEN_OFFSETS_DEG` and `TERMINATOR_SWEEP_BUDGET_MS`, and add `fetchCoordsCounted` to the `./lib/windyApi` import. Then add:

```ts
import { sweepWithEscalation } from './lib/terminatorSweep';
```

4. **Declare the route's ceiling.** `TICK_DEADLINE_MS` only means anything if
   the platform grants the tick at least that long, and this route inherited
   its limit rather than declaring one. Add `export const maxDuration = 60;`
   above `TICK_DEADLINE_MS`, as `app/api/kiosk/scenes/route.ts` and
   `app/api/snapshots/capture/route.ts` do. Widening makes a slow tick likelier
   — `tickStartedAt` now starts before the Windy fetch, and an escalated sweep
   can spend up to `TERMINATOR_SWEEP_BUDGET_MS` — so the two numbers stay
   pinned together: raising `TICK_DEADLINE_MS` means raising `maxDuration`.

- [ ] **Step 2b: Add the budget constant and delete the retired one**

In `app/lib/masterConfig.ts`, add the sweep budget beside the other terminator
constants Task 5 introduced:

```ts
// Wall-clock budget for the whole terminator sweep (base ring + any
// escalation rings), in milliseconds. The scoring loop that follows needs
// the remaining tick more than the pool needs extra cameras, so escalation
// rings are the first thing sacrificed on a slow tick. Chosen against a
// single observation (half of the 50s tick deadline, 2026-09-02); expect to
// tune it once the sweep telemetry has a few days of history.
export const TERMINATOR_SWEEP_BUDGET_MS = 25_000;
```

It starts at half of `TICK_DEADLINE_MS`, but as a value rather than as an
expression — the two are independently tunable and must not drift together by
accident.

Then delete the `TERMINATOR_RING_OFFSETS_DEG` export and its comment block;
`route.ts` was its last reader. Confirm with:

Run: `grep -rn "TERMINATOR_RING_OFFSETS_DEG" app/ --include=*.ts --include=*.tsx`
Expected: no hits.

- [ ] **Step 3: Surface the telemetry on the response**

In the final `NextResponse.json({...})`, add one field:

```ts
    sweep: sweep.telemetry,
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: clean. Then `npm run lint`.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test -- --run`
Expected: PASS. If a test asserted the old response shape, update it to expect the added `sweep` field rather than deleting the assertion.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/adaptive-terminator-widening
git add app/api/cron/update-cameras/route.ts app/lib/masterConfig.ts
git commit -m "feat(cron): sweep extra terminator rings when a feed runs thin"
```

- [ ] **Step 7: Push**

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' \
  push origin feat/adaptive-terminator-widening
```

---

## Verification after merge

The telemetry is the whole point; check it before trusting the feature.

1. Hit the cron endpoint and read `sweep` in the JSON response. On a healthy tick expect `escalations: 0` and one ring entry.
2. Wait for a thin period and confirm `escalations` rises, `rings[1].offsetDeg` is `15.75`, and `rings[1].newWebcams` is a meaningful fraction of `attempted`.
3. **Watch `empty` across rings.** A rising `empty` count against a flat `newWebcams` count is the signature of a Windy quota wall, which is the one risk the spec calls out and cannot be measured from outside.
4. **Check whether golden-hour frames actually pass the gate.** The spec's second risk: if the +15.75 ring's cameras are all gated to floor size, the day-side-first ordering is buying tiles that do not read as sunsets. Compare `passesGate` rates for the ids in `rings[1].newWebcamIds` against those in `rings[0].newWebcamIds` — `RingTelemetry` carries the ids for exactly this, since the `newWebcams` scalar alone cannot answer it.
5. **Then ask whether the floor should count only gate-passers.** The floor is compared against every camera the sweep found, gate-failers included, so a day-side ring that adds 16 floored daylight cameras clears the floor of 15 and stops escalation while the panel stays blank. Step 4's gate-pass rates decide this. If golden-hour frames largely pass, it is moot. If they do not, the fix is to count gate-passers — **not** to raise the floor, which buys more calls for more floored tiles.

## Deferred, deliberately

- **Persisting sweep telemetry to `daily_sunset_stats` for the Ops tab.** The spec asks for the Ops surface; this plan stops at the cron response and a structured log line, because persistence needs a migration and the response is enough to answer the two open risk questions. Follow-up once the shape has settled.
- **Splitting antimeridian boxes.** Task 1 clamps rather than wrapping, losing a sliver of ocean.
- **Cron cadence and image freshness.** Out of scope by decision.
