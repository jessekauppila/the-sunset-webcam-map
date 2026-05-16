# Custom Camera Visibility — Single Source of Truth

Status: Draft v0.1 — 2026-05-15
Owner: Jesse Kauppila
Subproject A of the post-MVP visibility/AR/hardware decomposition (see conversation 2026-05-15).

---

## 1. Problem

A custom Pi camera that was installed and provisioned this evening showed up on the map at the wrong time relative to the terminator. Windy webcams behave correctly — they appear when the terminator ring sweeps past them and disappear when it moves on — because the cron job's ring-radius search **is** the geometric filter. Custom cams take a different path that has no such filter: they enter `terminator_webcam_state` outside the ring/radius predicate and stay there regardless of where the sun currently is.

The result is two sources of truth for "is this camera visible right now" — one geometric (Windy), one essentially "did it ever exist" (custom). This spec collapses them into one.

## 2. Goals

1. Custom cameras appear on the map under the same geometric predicate that determines Windy visibility.
2. Custom cameras stop appearing when they are stale or offline, mirroring the "Windy returned nothing for this point" behavior.
3. No change to the snapshot upload path, the AI scoring path, the AR portal, the device firmware, or the frontend.
4. No new cron job. The visibility computation rides the existing `update-cameras` tick.

## 3. Non-goals

- Honoring `operator_preferences.phase_preference` (sunrise-only / sunset-only / both). v2 concern.
- Changing the visual treatment of empty / stale custom camera tiles in the frontend.
- Diagnosing why a specific test camera is producing a black image — separate subproject (B).
- Restructuring `classifyWebcamsByPhase` or the rank computation.
- Touching `backfillCustomSnapshotScores`. Scoring stays decoupled from visibility.

## 4. Current state

Verified from the repo as of commit `2fb861537`:

- **Windy flow** (`app/api/cron/update-cameras/route.ts`):
  1. `subsolarPoint(now)` → ring of points at `TERMINATOR_SUN_ALTITUDE_DEG = -13°`, precision `TERMINATOR_PRECISION_DEG = 12°`.
  2. For each ring point: Windy API call with radius `SEARCH_RADIUS_DEG = 9°`.
  3. `classifyWebcamsByPhase(webcams, sunriseCoords, sunsetCoords)` assigns each result to a phase by nearest-ring-point distance.
  4. `upsertTerminatorState` marks the row `active=true` with a rank.
  5. `deactivateMissingTerminatorState` flips rows not seen this tick to `active=false`.
  6. The map reads `terminator_webcam_state` where `active=true` via `fetchTerminatorWebcams`.

- **Custom flow** (`app/api/cameras/[id]/snapshot/route.ts` + `app/api/cron/update-cameras/lib/customBackfill.ts`):
  1. Device POSTs an image → row in `webcam_snapshots` keyed by `webcam_id`. `cameras.last_seen_at` is bumped. The terminator payload cache is invalidated.
  2. The cron's `backfillCustomSnapshotScores` step scores any snapshot with a NULL `ai_regression_score`.
  3. **Nothing in either path runs the ring/radius predicate against custom cameras.** Their `terminator_webcam_state` row, if any, was populated elsewhere (likely at registration) and persists.

## 5. Design

### 5.1 Behavior

A custom camera is `active=true` in `terminator_webcam_state` at the end of a cron tick iff **both** are true:

1. **Geometric predicate**: its `(lat, lng)` is within `SEARCH_RADIUS_DEG` degrees of at least one terminator ring point computed for `now`, using the same Euclidean distance and same `classifyWebcamsByPhase` math the Windy flow uses.
2. **Freshness predicate**: it has at least one row in `webcam_snapshots` where `captured_at >= now - CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES`.

Default `CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES = 90`. Rationale: the device protocol defines active windows as ~75 min long (45 before sunrise + 30 after; 30 before sunset + 45 after). 90 min covers any in-window snapshot plus a small buffer for upload latency.

Failing either predicate → `active=false`. (Same disappearance semantics as a Windy cam the API stopped returning.)

### 5.2 Code organization

One new file: `app/api/cron/update-cameras/lib/customClassification.ts`.

Exports a single function:

```ts
export async function classifyCustomCamerasForTick(opts: {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
  freshnessWindowMinutes: number;
  now: Date;
}): Promise<{ sunrise: WindyWebcam[]; sunset: WindyWebcam[] }>
```

Internally:
1. One SQL query selects all `webcams` rows where `source='custom'` AND there exists a `webcam_snapshots` row for that webcam with `captured_at >= now - interval`.
2. Shape the rows into `WindyWebcam` objects (same shape `classifyWebcamsByPhase` already consumes) — populate `webcamId`, `location`, plus whatever minimal fields downstream needs. Helper `imagesFromCustomSnapshot` already exists for the popup image; reuse for shape consistency where useful, but classification only needs `webcamId` + `location`.
3. Call the existing `classifyWebcamsByPhase` with the same ring coords used for the Windy call. Same Euclidean math, same nearest-ring-point bucket assignment, same latitude sort.
4. Return `{sunrise, sunset}`.

The cron route (`update-cameras/route.ts`) calls this function after the Windy classification, before the upsert/deactivate phase. It then:

- Unions the Windy and custom results per phase by `webcam_id`.
- Passes the unioned `sunrise` / `sunset` lists into the existing `upsertTerminatorState` calls.
- Passes the unioned list of all `active webcam_ids` per phase into `deactivateMissingTerminatorState` — so cams missing on either source get correctly flipped to `active=false`.

`upsertTerminatorState` and `deactivateMissingTerminatorState` are unchanged. They already key by `webcam_id` and don't care whether the row came from Windy or custom.

### 5.3 Ranking

Within a phase bucket, `upsertTerminatorState` assigns `rank` from the array index of its input list (`webcams.map(async (w, rank) => ...)` in `dbOperations.ts`). For Windy that index reflects `classifyWebcamsByPhase`'s post-sort order, which is by latitude (north→south for sunrise, south→north for sunset).

Custom cams flow through the same `classifyWebcamsByPhase` call, so they inherit the same latitude-sorted rank within their own pre-union list. After the Windy/custom union (§5.2), the combined per-phase list keeps Windy entries first and appends custom entries that weren't already present, preserving each source's relative latitude order. The merged list is then passed to `upsertTerminatorState`, which re-assigns rank from the merged array index.

Rank collisions across past ticks are fine — `rank` has no uniqueness constraint, it's used for ordering only and is overwritten on every upsert.

### 5.4 New config

In `app/lib/masterConfig.ts`, under the "Terminator geometry + map search" section:

```ts
// How recent a custom camera's most recent snapshot must be for the camera
// to qualify for terminator visibility. Mirrors Windy's "the API returned
// it this tick" semantics — custom cams without a fresh capture are
// effectively unobservable and should fall off the map.
//
// Default 90 min: covers the protocol's 75-min active window + upload buffer.
export const CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES = 90;
```

No environment-variable override in v1.

### 5.5 Data flow diagram

```
cron tick @ now
   │
   ├── subsolarPoint(now) → ring coords (sunriseCoords, sunsetCoords)
   │
   ├── [Windy path] fetchWebcamsInBatches → classifyWebcamsByPhase → {sunrise_w, sunset_w}
   │
   ├── [Custom path, NEW] classifyCustomCamerasForTick(coords, 90min, now)
   │     │
   │     ├── SELECT webcams WHERE source='custom' AND EXISTS recent snapshot
   │     └── classifyWebcamsByPhase(rows, sunriseCoords, sunsetCoords) → {sunrise_c, sunset_c}
   │
   ├── sunrise = union(sunrise_w, sunrise_c) by webcam_id
   ├── sunset  = union(sunset_w,  sunset_c)  by webcam_id
   │
   ├── upsertTerminatorState(sunrise + sunset)
   └── deactivateMissingTerminatorState(active_ids per phase)

  → frontend reads terminator_webcam_state where active=true
```

## 6. Testing

### 6.1 Unit (new)

`app/api/cron/update-cameras/lib/customClassification.test.ts`:
- Mock SQL to return a fixed set of `source='custom'` webcams with controlled coords and snapshot timestamps.
- Fixed ring coords passed in.
- Assert: cams inside radius + with fresh snapshot end up in the correct phase bucket. Cams outside radius are excluded. Cams with stale snapshots are excluded. Cams with no snapshot ever are excluded.
- Assert: rank within bucket is in ascending order of distance to nearest ring point, ties broken by `webcam_id`.

### 6.2 Integration

Extend `app/api/cron/update-cameras/route.test.ts`:
- Seed a custom webcam at a coord inside the test ring with a snapshot timestamped `now - 30min`. Run the tick. Assert its row in `terminator_webcam_state` has `active=true` and a sensible rank.
- Seed a custom webcam at a coord outside the ring with the same fresh snapshot. Run the tick. Assert `active=false` (or absent).
- Seed a custom webcam inside the ring with a snapshot timestamped `now - 120min`. Run the tick. Assert `active=false`.
- Seed a custom webcam that was previously `active=true` and assert it flips to `active=false` after a tick where it no longer qualifies.

### 6.3 Manual verification

- Run the cron locally with the test Pi camera at its real location.
- Verify it goes `active=true` only when the terminator ring is geometrically over it AND it has uploaded recently.
- Verify it goes `active=false` once the ring moves past or the device stops uploading.

## 7. Risks and rollback

- **Risk: my test camera was previously `active=true` outside the ring, and after this lands it goes dark unless I'm actively uploading inside a real sun window.** This is the intended behavior — the bug *was* that it stayed on the map at the wrong time. Document it in the commit message.
- **Risk: tick latency goes up.** New SQL is small (custom cams are few) and runs against the existing `idx_webcam_snapshots_webcam_captured_desc` index on `webcam_snapshots(webcam_id, captured_at DESC)` from migration `20260514_webcam_snapshots_latest_idx.sql`. No new index required.
- **Rollback**: revert the call site in `route.ts`. The new module becomes dead code. No schema migration to undo.

## 8. Implementation slice order

1. Add `CUSTOM_CAM_FRESHNESS_WINDOW_MINUTES` to `masterConfig.ts`.
2. Write `customClassification.ts` + unit test (TDD: test first).
3. Wire into `route.ts`: call new function, union with Windy results, feed combined lists into upsert/deactivate.
4. Extend `route.test.ts` integration cases.
5. Local manual verification with the real test camera.
6. Deploy. Monitor `terminator_webcam_state` for a couple of cron ticks to confirm sane active counts.

## 9. Open questions deferred

- Should `operator_preferences.phase_preference` filter cams out of the wrong phase bucket? Pulled into a v2 spec.
- Should the frontend visually distinguish a custom cam whose snapshot is older than N minutes but still inside the freshness window? UI concern; not blocking.
- Does the AR portal's `horizon_profile` need to factor into visibility (e.g. cam pointed at a wall — geometrically eligible but functionally blind)? Deferred to the AR portal subproject (C/D).
