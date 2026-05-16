# Custom Camera Visibility — Single Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make custom Pi cameras appear/disappear on the map by the exact same ring/radius predicate that governs Windy webcams, plus a freshness window so stale/offline cams fall off cleanly.

**Architecture:** One new module — `customClassification.ts` — runs inside the existing `update-cameras` cron tick. It fetches `source='custom'` webcams that have a recent snapshot, runs them through the same `classifyWebcamsByPhase` against the same ring coords already built for the Windy call, and produces sunrise/sunset lists. Those lists are unioned with the Windy results before upsert, so `terminator_webcam_state` ends up reflecting one consistent geometric/freshness rule across all sources.

**Spec deviation note** (from spec §5.2): the spec claimed `upsertTerminatorState` and `deactivateMissingTerminatorState` are unchanged. On closer inspection both are Windy-coupled: `upsertTerminatorState` translates Windy `external_id` → DB `webcam_id` internally via `idByExternal`, and `deactivateMissingTerminatorState` has `w.source = 'windy'` hardcoded so custom rows can never be deactivated. This plan refactors both to be source-agnostic, which serves the spec's intent of one predicate governing all sources.

**Tech Stack:** Next.js 15 (App Router) / TypeScript / Postgres (via `@/app/lib/db`'s `sql` template tag) / Vitest.

**Spec:** `docs/superpowers/specs/2026-05-15-custom-cam-visibility-single-source-of-truth-design.md`.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `app/lib/masterConfig.ts` | Add `CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES` constant |
| Modify | `app/api/cron/update-cameras/lib/dbOperations.ts` | Refactor `upsertTerminatorState` to take pre-resolved DB ids; drop `source='windy'` from `deactivateMissingTerminatorState` |
| Modify | `app/api/cron/update-cameras/lib/dbOperations.test.ts` | Update tests to match new signatures |
| Create | `app/api/cron/update-cameras/lib/customClassification.ts` | Fetch + filter + classify custom cams for this tick |
| Create | `app/api/cron/update-cameras/lib/customClassification.test.ts` | Unit tests for the new module |
| Modify | `app/api/cron/update-cameras/route.ts` | Call new module; union with Windy results; pass DB ids to refactored upsert |
| Modify | `app/api/cron/update-cameras/route.test.ts` | Integration tests for the union + active/inactive flips |

Custom-camera classification stays in its own file (single responsibility, easy to unit-test independently). The refactor of `dbOperations.ts` is *minimal* — only the two functions touched are the ones whose Windy-coupling blocks single-source-of-truth.

---

## Task 1: Add the freshness-window config constant

**Files:**
- Modify: `app/lib/masterConfig.ts`

- [ ] **Step 1: Add the constant under the "Terminator geometry + map search" section**

In `app/lib/masterConfig.ts`, immediately after the `TERMINATOR_RING_OFFSETS_DEG` line (around line 30), insert:

```typescript
// How recent a custom camera's most-recent snapshot must be for the camera
// to qualify for terminator visibility. Mirrors Windy's "API returned it
// this tick" semantics — custom cams without a fresh capture are
// effectively unobservable and should fall off the map.
// Default 90 min: covers the protocol's 75-min active window + upload buffer.
export const CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES = 90;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/masterConfig.ts
git commit -m "feat(config): add CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES (90)"
```

---

## Task 2: Refactor `upsertTerminatorState` to take pre-resolved DB ids

The current signature `upsertTerminatorState(webcams: WindyWebcam[], phase, idByExternal)` does internal external-id → DB-id translation. To make custom cams (which already have DB ids) flow through, lift that translation out to the caller.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts` (lines 130–155)
- Modify: `app/api/cron/update-cameras/lib/dbOperations.test.ts`

- [ ] **Step 1: Update the test first (write the failing test)**

Open `app/api/cron/update-cameras/lib/dbOperations.test.ts`. If a test for `upsertTerminatorState` exists, update it; if not, add this block. Either way the goal is to express the new contract:

```typescript
import { upsertTerminatorState } from './dbOperations';

vi.mock('@/app/lib/db', () => ({
  sql: vi.fn(),
}));

describe('upsertTerminatorState', () => {
  it('upserts rows with pre-resolved DB webcam_id and array-index rank', async () => {
    const { sql } = await import('@/app/lib/db');
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock.mockResolvedValue(undefined);

    await upsertTerminatorState(
      [
        { webcamId: 42 },
        { webcamId: 7 },
      ],
      'sunrise',
    );

    // One call per row; rank is the array index
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts -t "upsertTerminatorState"`
Expected: FAIL — the current signature requires three args (`webcams`, `phase`, `idByExternal`), and the call site here passes two.

- [ ] **Step 3: Refactor `upsertTerminatorState` in `dbOperations.ts`**

In `app/api/cron/update-cameras/lib/dbOperations.ts`, replace the existing `upsertTerminatorState` (currently around line 130) with:

```typescript
/**
 * Upsert terminator-state rows from pre-resolved DB webcam ids.
 * Rank is the array index. Caller is responsible for any ordering
 * decisions (sort, union, dedupe) before passing the array in.
 */
export async function upsertTerminatorState(
  rows: Array<{ webcamId: number }>,
  phase: 'sunrise' | 'sunset',
): Promise<void> {
  const promises = rows.map(async (row, rank) => {
    const { webcamId } = row;
    await sql`
      insert into terminator_webcam_state (webcam_id, phase, rank, last_seen_at, updated_at, active)
      values (${webcamId}, ${phase}, ${rank}, now(), now(), true)
      on conflict (webcam_id, phase) do update set
        rank = excluded.rank,
        last_seen_at = now(),
        updated_at = now(),
        active = true
    `;
  });

  await Promise.all(promises);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts -t "upsertTerminatorState"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/dbOperations.ts app/api/cron/update-cameras/lib/dbOperations.test.ts
git commit -m "refactor(cron): upsertTerminatorState takes pre-resolved DB ids"
```

---

## Task 3: Make `deactivateMissingTerminatorState` source-agnostic

Currently the function has `w.source = 'windy'` hardcoded, so it can never flip a custom row to `active=false`. Drop the source filter; the caller is now responsible for passing a complete union of active ids.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts` (lines ~155–190)
- Modify: `app/api/cron/update-cameras/lib/dbOperations.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `dbOperations.test.ts`:

```typescript
describe('deactivateMissingTerminatorState', () => {
  it('deactivates rows of any source not in the active set', async () => {
    const { sql } = await import('@/app/lib/db');
    const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
    sqlMock.mockResolvedValue(undefined);

    await deactivateMissingTerminatorState('sunrise', [42, 99]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // The SQL template-tag invocation should NOT reference w.source = 'windy'.
    const firstCallStrings = sqlMock.mock.calls[0][0] as readonly string[];
    expect(firstCallStrings.join(' ')).not.toContain("source = 'windy'");
  });
});
```

Add the import at the top of the test file if it isn't there:

```typescript
import { deactivateMissingTerminatorState } from './dbOperations';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts -t "deactivateMissingTerminatorState"`
Expected: FAIL — the current implementation contains `source = 'windy'`.

- [ ] **Step 3: Update `deactivateMissingTerminatorState`**

In `app/api/cron/update-cameras/lib/dbOperations.ts`, replace the function with:

```typescript
/**
 * Flip rows in this phase to active=false unless their webcam_id is in
 * activeWebcamIds. Source-agnostic: caller is responsible for unioning
 * active ids across Windy + custom (or any other source) before calling.
 */
export async function deactivateMissingTerminatorState(
  phase: 'sunrise' | 'sunset',
  activeWebcamIds: number[],
): Promise<void> {
  if (activeWebcamIds.length === 0) {
    await sql`
      update terminator_webcam_state
      set active = false, updated_at = now()
      where phase = ${phase}
        and active = true
    `;
    return;
  }

  await sql`
    update terminator_webcam_state
    set active = false, updated_at = now()
    where phase = ${phase}
      and active = true
      and webcam_id <> all(${activeWebcamIds})
  `;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/dbOperations.ts app/api/cron/update-cameras/lib/dbOperations.test.ts
git commit -m "refactor(cron): deactivateMissingTerminatorState is source-agnostic"
```

---

## Task 4: Update the route to use refactored signatures (no behavior change yet)

Bring `route.ts` in line with the new signatures. The Windy flow still works end-to-end after this task — custom cams enter in Task 6. This is a pure refactor commit so any regression here is small and bisectable.

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts` (around lines 218–232)
- Modify: `app/api/cron/update-cameras/route.test.ts` (mocks for `upsertTerminatorState` already exist)

- [ ] **Step 1: Update the call site in `route.ts`**

In `app/api/cron/update-cameras/route.ts`, replace the block currently around lines 218–232 (the two `upsertTerminatorState` calls and the `sunriseIds`/`sunsetIds` derivation) with:

```typescript
  // Resolve Windy external_id → DB webcam_id once for both upsert + deactivate
  function toDbRows(list: typeof sunriseList) {
    return list
      .map((w) => idByExternal.get(String(w.webcamId)))
      .filter((id): id is number => id !== undefined)
      .map((webcamId) => ({ webcamId }));
  }
  const sunriseRows = toDbRows(sunriseList);
  const sunsetRows = toDbRows(sunsetList);

  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  const sunriseIds = sunriseRows.map((r) => r.webcamId);
  const sunsetIds = sunsetRows.map((r) => r.webcamId);
  await deactivateMissingTerminatorState('sunrise', sunriseIds);
  await deactivateMissingTerminatorState('sunset', sunsetIds);
```

- [ ] **Step 2: Update the existing route test mocks if needed**

Most of `route.test.ts` mocks `upsertTerminatorState` as a generic spy, so the new signature is transparent. If any existing assertion inspects the args of `upsertStateMock`, update it to match the new shape (`[{webcamId: number}], phase`). Search for `upsertStateMock` in `route.test.ts`; adjust as needed.

- [ ] **Step 3: Run all cron tests**

Run: `npx vitest run app/api/cron/update-cameras`
Expected: all PASS.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "refactor(cron): route uses new upsert/deactivate signatures"
```

---

## Task 5: Write `customClassification.ts` (TDD, test first)

The new module is the core of this work. Fetch custom cams with a fresh snapshot, classify them with the same `classifyWebcamsByPhase` math, return sunrise/sunset arrays of pre-resolved DB ids in latitude order (as `classifyWebcamsByPhase` already produces).

**Files:**
- Create: `app/api/cron/update-cameras/lib/customClassification.test.ts`
- Create: `app/api/cron/update-cameras/lib/customClassification.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/cron/update-cameras/lib/customClassification.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { classifyCustomCamerasForTick } from './customClassification';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('classifyCustomCamerasForTick', () => {
  const sunriseCoords = [{ lat: 0, lng: 0 }];
  const sunsetCoords = [{ lat: 0, lng: 180 }];

  it('returns rows in sunrise bucket for cams near sunriseCoords', async () => {
    sqlMock.mockResolvedValue([
      { webcam_id: 101, lat: 0.1, lng: 0.1 },
      { webcam_id: 102, lat: -0.1, lng: 0.2 },
    ]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise.map((r) => r.webcamId).sort()).toEqual([101, 102]);
    expect(sunset).toEqual([]);
  });

  it('places cams in sunset bucket when nearer sunsetCoords', async () => {
    sqlMock.mockResolvedValue([
      { webcam_id: 200, lat: 0, lng: 179 },
    ]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise).toEqual([]);
    expect(sunset.map((r) => r.webcamId)).toEqual([200]);
  });

  it('returns empty arrays when SQL returns no rows', async () => {
    sqlMock.mockResolvedValue([]);

    const { sunrise, sunset } = await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now: new Date('2026-05-15T00:00:00Z'),
    });

    expect(sunrise).toEqual([]);
    expect(sunset).toEqual([]);
  });

  it('passes freshness threshold into the SQL parameters', async () => {
    sqlMock.mockResolvedValue([]);
    const now = new Date('2026-05-15T12:00:00Z');

    await classifyCustomCamerasForTick({
      sunriseCoords,
      sunsetCoords,
      freshnessWindowMinutes: 90,
      now,
    });

    // sqlMock receives the tagged-template strings + values. The freshness
    // cutoff is a value at position 0 (the only one). It should be a Date
    // 90 minutes before `now`.
    const callValues = sqlMock.mock.calls[0].slice(1) as unknown[];
    const passed = callValues[0] as Date;
    const expected = new Date(now.getTime() - 90 * 60_000);
    expect(passed.getTime()).toBe(expected.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails (file does not exist)**

Run: `npx vitest run app/api/cron/update-cameras/lib/customClassification.test.ts`
Expected: FAIL — module `./customClassification` cannot be resolved.

- [ ] **Step 3: Implement the module**

Create `app/api/cron/update-cameras/lib/customClassification.ts`:

```typescript
import { sql } from '@/app/lib/db';
import type { Location, WindyWebcam } from '@/app/lib/types';
import { classifyWebcamsByPhase } from './webcamClassification';

interface CustomCamRow {
  webcam_id: number;
  lat: number;
  lng: number;
}

export interface CustomTerminatorRow {
  webcamId: number;
}

export async function classifyCustomCamerasForTick(opts: {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
  freshnessWindowMinutes: number;
  now: Date;
}): Promise<{
  sunrise: CustomTerminatorRow[];
  sunset: CustomTerminatorRow[];
}> {
  const cutoff = new Date(
    opts.now.getTime() - opts.freshnessWindowMinutes * 60_000,
  );

  const rows = (await sql`
    select w.id as webcam_id, w.lat, w.lng
    from webcams w
    where w.source = 'custom'
      and exists (
        select 1 from webcam_snapshots s
        where s.webcam_id = w.id
          and s.captured_at >= ${cutoff}
      )
  `) as CustomCamRow[];

  if (rows.length === 0) {
    return { sunrise: [], sunset: [] };
  }

  // Shape into the WindyWebcam-ish form classifyWebcamsByPhase consumes.
  // Only `webcamId` and `location.{latitude,longitude}` are read; required
  // fields per the WindyWebcam interface get empty/zero defaults.
  const shaped: WindyWebcam[] = rows.map((r) => ({
    webcamId: r.webcam_id,
    title: '',
    viewCount: 0,
    status: 'unknown',
    categories: [],
    location: {
      latitude: r.lat,
      longitude: r.lng,
    },
  }));

  const { sunrise, sunset } = classifyWebcamsByPhase(
    shaped,
    opts.sunriseCoords,
    opts.sunsetCoords,
  );

  return {
    sunrise: sunrise.map((w) => ({ webcamId: w.webcamId as number })),
    sunset: sunset.map((w) => ({ webcamId: w.webcamId as number })),
  };
}
```

Note: the only fields `classifyWebcamsByPhase` reads (`app/api/cron/update-cameras/lib/webcamClassification.ts:11-38`) are `webcamId` and `location.{latitude,longitude}`. The other fields exist only to satisfy `WindyWebcam`'s required props (`app/lib/types.ts:25-58`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/customClassification.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. If `WindyWebcam` requires additional fields, add empty/null defaults in the `shaped` mapping to satisfy the type.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/customClassification.ts app/api/cron/update-cameras/lib/customClassification.test.ts
git commit -m "feat(cron): classify custom cameras by ring/freshness predicate"
```

---

## Task 6: Wire `customClassification` into the cron route

Now the new module joins the live tick. Union Windy + custom per phase, dedupe by `webcamId`, then upsert and deactivate as one set.

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts`

- [ ] **Step 1: Add the import**

Near the top of `app/api/cron/update-cameras/route.ts`, add:

```typescript
import { classifyCustomCamerasForTick } from './lib/customClassification';
import { CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES } from '@/app/lib/masterConfig';
```

Add `CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES` to the existing destructured import from `@/app/lib/masterConfig` if one is in place (search for the existing import to merge cleanly).

- [ ] **Step 2: Call the new function and union with Windy results**

Replace the block from the end of the previous `toDbRows`/upsert section (the one you wrote in Task 4) with:

```typescript
  // Resolve Windy external_id → DB webcam_id rows
  function toWindyDbRows(list: typeof sunriseList) {
    return list
      .map((w) => idByExternal.get(String(w.webcamId)))
      .filter((id): id is number => id !== undefined)
      .map((webcamId) => ({ webcamId }));
  }
  const sunriseWindyRows = toWindyDbRows(sunriseList);
  const sunsetWindyRows = toWindyDbRows(sunsetList);

  // Classify custom cams against the same ring coords + freshness window
  const customClassified = await classifyCustomCamerasForTick({
    sunriseCoords,
    sunsetCoords,
    freshnessWindowMinutes: CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES,
    now,
  });

  // Union Windy + custom by webcamId, Windy first (preserves Windy lat-sorted rank).
  function unionByWebcamId(
    primary: Array<{ webcamId: number }>,
    secondary: Array<{ webcamId: number }>,
  ): Array<{ webcamId: number }> {
    const seen = new Set<number>();
    const out: Array<{ webcamId: number }> = [];
    for (const r of primary) {
      if (!seen.has(r.webcamId)) {
        seen.add(r.webcamId);
        out.push(r);
      }
    }
    for (const r of secondary) {
      if (!seen.has(r.webcamId)) {
        seen.add(r.webcamId);
        out.push(r);
      }
    }
    return out;
  }
  const sunriseRows = unionByWebcamId(sunriseWindyRows, customClassified.sunrise);
  const sunsetRows = unionByWebcamId(sunsetWindyRows, customClassified.sunset);

  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  const sunriseIds = sunriseRows.map((r) => r.webcamId);
  const sunsetIds = sunsetRows.map((r) => r.webcamId);
  await deactivateMissingTerminatorState('sunrise', sunriseIds);
  await deactivateMissingTerminatorState('sunset', sunsetIds);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run the full cron test suite (Task 7 will extend it; this confirms nothing regressed)**

Run: `npx vitest run app/api/cron/update-cameras`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts
git commit -m "feat(cron): include custom cams in terminator visibility set"
```

---

## Task 7: Integration tests in `route.test.ts`

Now that the wiring is live, lock the cross-module behavior with integration coverage.

**Files:**
- Modify: `app/api/cron/update-cameras/route.test.ts`

- [ ] **Step 1: Add the new module mock**

Near the other `vi.mock` blocks at the top of `route.test.ts`, add:

```typescript
const classifyCustomMock = vi.fn();
vi.mock('./lib/customClassification', () => ({
  classifyCustomCamerasForTick: (...a: unknown[]) => classifyCustomMock(...a),
}));
```

In the `beforeEach` block, reset it: `classifyCustomMock.mockReset();`
Then give it a default return: `classifyCustomMock.mockResolvedValue({ sunrise: [], sunset: [] });`

- [ ] **Step 2: Add a test that asserts custom cams reach upsert**

Append to the existing `describe` in `route.test.ts`:

```typescript
it('unions custom cams into the upsert active set', async () => {
  // Standard Windy mocks (mirror existing tests' happy path; copy whatever
  // the test file already does to make the route's GET return 200).
  classifyMock.mockReturnValue({
    sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
    sunset: [],
  });
  getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
  classifyCustomMock.mockResolvedValue({
    sunrise: [{ webcamId: 999 }],
    sunset: [],
  });

  const { GET } = await import('./route');
  await GET(new Request('http://x/api/cron/update-cameras'));

  // Last upsert call for 'sunrise' should include both ids
  const sunriseUpsertCall = upsertStateMock.mock.calls.find(
    (c) => c[1] === 'sunrise',
  );
  expect(sunriseUpsertCall).toBeDefined();
  const rows = sunriseUpsertCall![0] as Array<{ webcamId: number }>;
  expect(rows.map((r) => r.webcamId).sort()).toEqual([1, 999]);
});

it('passes the union of ids to deactivateMissingTerminatorState', async () => {
  classifyMock.mockReturnValue({
    sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
    sunset: [],
  });
  getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
  classifyCustomMock.mockResolvedValue({
    sunrise: [{ webcamId: 999 }],
    sunset: [],
  });

  const { GET } = await import('./route');
  await GET(new Request('http://x/api/cron/update-cameras'));

  const sunriseDeactCall = deactivateMock.mock.calls.find(
    (c) => c[0] === 'sunrise',
  );
  expect(sunriseDeactCall).toBeDefined();
  expect((sunriseDeactCall![1] as number[]).sort()).toEqual([1, 999]);
});

it('skips upsert/deactivate for empty buckets gracefully', async () => {
  classifyMock.mockReturnValue({ sunrise: [], sunset: [] });
  getIdMapMock.mockResolvedValue(new Map());
  classifyCustomMock.mockResolvedValue({ sunrise: [], sunset: [] });

  const { GET } = await import('./route');
  const res = await GET(new Request('http://x/api/cron/update-cameras'));
  expect(res.status).toBe(200);
});
```

Notes:
- If the existing tests use `await import('./route', ...)` cache-busting (`vi.resetModules` / dynamic-import with cache-bust), follow the same pattern.
- The `classifyMock` and `getIdMapMock` calls assume the existing harness shape. If the existing test file uses different names, rename to match.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: all PASS (existing + 3 new).

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/update-cameras/route.test.ts
git commit -m "test(cron): cover custom-cam union, dedupe, and empty-bucket cases"
```

---

## Task 8: Run the full suite and type-check

Before manual verification, make sure nothing else regressed.

- [ ] **Step 1: Full test run**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean (or only the warnings the repo already has on `main`; do not introduce new ones).

If anything fails, fix in place and amend the most recent commit OR add a new fix commit, depending on which task introduced the regression.

---

## Task 9: Manual verification with the real test camera

Confirm the behavior the user originally reported is fixed.

- [ ] **Step 1: Run the cron locally**

In one terminal, start the Next dev server: `npm run dev`.
In another terminal, hit the cron endpoint. The auth helper (`app/api/cron/update-cameras/lib/auth.ts`) accepts either:

```bash
# Option A: Authorization header
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/update-cameras

# Option B: ?secret= query param (simpler for local poking)
curl "http://localhost:3000/api/cron/update-cameras?secret=$CRON_SECRET"
```

Expected: response JSON includes `customBackfill` + a sane summary; status 200.

- [ ] **Step 2: Inspect `terminator_webcam_state` for the test camera**

In the Neon SQL console or via `psql`:

```sql
select s.webcam_id, s.phase, s.rank, s.active, s.last_seen_at, w.source, w.lat, w.lng
from terminator_webcam_state s
join webcams w on w.id = s.webcam_id
where w.source = 'custom'
order by s.updated_at desc;
```

Expected: the test camera shows `active=true` only if (a) it is geometrically within ~9° of the current ring AND (b) has a snapshot in the last 90 minutes. Otherwise `active=false`.

- [ ] **Step 3: Verify the map UI**

Visit the app at `http://localhost:3000`. Confirm the test camera's dot appears/disappears in correspondence with the rendered terminator ring as expected — i.e. it's only on the map when the ring is sweeping near its location AND it has been uploading recently.

- [ ] **Step 4: If verification passes, write a short summary in the commit log or PR description**

Note specifically: "Before this change, the test camera at $LAT/$LNG was `active=true` even at $LOCAL_TIME (well outside the terminator). After this change, it now correctly flips `active=false` until the ring sweeps over its location."

---

## Task 10: Open PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <current-branch-name>
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(cron): one predicate for Windy + custom camera visibility" --body "$(cat <<'EOF'
## Summary
- Custom Pi cameras now appear/disappear on the map by the exact same ring/radius predicate as Windy webcams, plus a 90-minute snapshot-freshness window so stale/offline cams fall off cleanly.
- Refactors `upsertTerminatorState` / `deactivateMissingTerminatorState` to be source-agnostic — the spec called them "unchanged" but they were Windy-coupled.
- Spec: `docs/superpowers/specs/2026-05-15-custom-cam-visibility-single-source-of-truth-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-custom-cam-visibility-single-source-of-truth.md`

## Test plan
- [ ] `npx vitest run` — green
- [ ] `npx tsc --noEmit` — clean
- [ ] Cron run locally; test camera flips `active=false` when outside ring/freshness
- [ ] Map UI: test camera dot appears only during the active window
EOF
)"
```

Done.

---

## Risks recap

- **Existing custom rows go from `active=true` (incorrect) to `active=false` (correct) after deploy.** That's the bug fix. Document in the PR/commit message so it isn't mistaken for a regression.
- **Tick latency:** the new SQL is small (handful of `source='custom'` cams) and uses the existing `idx_webcam_snapshots_webcam_captured_desc` index from migration `20260514_webcam_snapshots_latest_idx.sql`. No new index needed.
- **Rollback:** revert the Task 6 commit. The refactor commits (Tasks 2, 3, 4) are independently safe — they leave Windy behavior identical.
