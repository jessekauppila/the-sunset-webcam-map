# Custom Camera Popup Image Design

**Date:** 2026-05-14
**Status:** Draft
**Branch context:** `feat/tier-0-cameras` (the Tier 0 cameras line of work)

---

## Overview

Tier 0 of the custom edge-camera fleet shipped 2026-05-13. The Pi at `camera_id=1` is uploading JPEGs to `webcam_snapshots` end-to-end, the row appears in `/api/db-terminator-webcams`, and the pin renders on the mosaic when the terminator passes overhead. But clicking the pin shows the fallback emoji UI, not the camera's image — because the popup component reads `webcam.images.current.preview`, and `webcams.images` is `NULL` for `source = 'custom'` rows (it's populated only by the Windy cron).

This spec describes a read-time fix: the terminator endpoint joins the latest `webcam_snapshots` row for each custom camera and synthesizes a minimal `images` payload so the popup renders the camera's most recent capture without any source-specific frontend logic. The same data path also serves as the shared seam for the future admin / fleet status view.

The fix is deliberately small and explicit. No write-side denormalization, no streaming, no multi-resolution thumbnails. The wire shape introduces explicit naming for what kind of asset is on screen (`live_asset_kind`) and explicit traceability fields (`device_class`, `firmware_version`, `hardware_id`, `latest_snapshot_captured_at`) so future formats — Pi Gen 2, ESP32, MJPEG streams — slot in without lying about the present.

---

## Goals

- Custom-camera popups render the most recent uploaded snapshot, with the popup component itself unchanged in its core rendering path.
- The popup surfaces a "Captured Nm ago" freshness label for `source = 'custom'` cameras, making "live" visibly distinct from "Windy still."
- The `WebcamImages` type is honest: optional fields where they truly are optional, no fabricated dimensions or duplicated URLs masquerading as multiple resolutions.
- The data path is shared between the public popup and the future `/admin/cameras` view via a single `customCameraState` helper module — one source of truth for "what's the live state of a custom camera."
- The wire shape includes explicit traceability fields (`device_class`, `firmware_version`, `hardware_id`) for `source = 'custom'` rows so any frame is traceable to specific hardware/firmware in logs, popups, and the future admin view.
- The wire shape introduces a `live_asset_kind` discriminator (`'windy_bundle' | 'custom_snapshot' | 'custom_stream'`) so future formats — multi-resolution custom snapshots, MJPEG/WebRTC streams — slot in without breaking changes.

## Non-goals

- **No write-time denormalization.** Snapshot ingest endpoint does not `UPDATE webcams.images`. Drift-free by construction; cost paid at read time.
- **No live-streaming support.** Phase 2 of the device protocol (MJPEG opt-in) is acknowledged in the type design but not implemented.
- **No multi-resolution snapshot generation.** The Pi uploads one image at native resolution; the wire shape says exactly that.
- **No admin view / fleet status table.** Spec includes the shared helper that the admin view will reuse, but the admin endpoint and UI are separate work.
- **No source-conditional rendering inside the popup.** The popup remains source-agnostic; the synthesis happens server-side so the seam is at one boundary.
- **No fallback emoji UI changes.** Existing behavior (lines 119–151 of `webcamPopup.tsx`) is preserved exactly for the "no snapshot ever" case.
- **No changes to the Windy import pipeline** or to how `webcams.images` is populated for Windy rows.

---

## Section 1: Data path — single SQL change

The entire backend change lives in `app/lib/terminatorPayload.ts:45–97`. The existing query joins `terminator_webcam_state ← webcams`; we add a `LEFT JOIN cameras` for traceability metadata and a `LEFT JOIN LATERAL` over `webcam_snapshots` for the latest capture.

```sql
SELECT
  ...,                                   -- existing columns
  w.images,
  ls.firebase_url     AS latest_snapshot_url,
  ls.captured_at      AS latest_snapshot_captured_at,
  c.device_class,
  c.firmware_version,
  c.hardware_id
FROM terminator_webcam_state s
JOIN webcams w ON w.id = s.webcam_id
LEFT JOIN cameras c ON c.id = w.custom_camera_id
LEFT JOIN LATERAL (
  SELECT firebase_url, captured_at
  FROM webcam_snapshots
  WHERE webcam_id = w.id AND w.source = 'custom'
  ORDER BY captured_at DESC
  LIMIT 1
) ls ON TRUE
WHERE s.active = true
ORDER BY phase, rank
LIMIT 2000;
```

Key properties:

- **The `LATERAL` is gated by `w.source = 'custom'`.** For Windy rows the lateral subquery returns nothing (`ls.firebase_url` is `NULL`) and behaves as a no-op. No measurable cost on the ~99% Windy fleet.
- **The `LEFT JOIN cameras` is naturally gated by `w.custom_camera_id`.** Only custom rows have a non-null `custom_camera_id` pointing at a `cameras` row; Windy rows get `NULL` for all device fields, which we just don't surface.
- **Empty-state preservation.** For a `source = 'custom'` row with no snapshots ever, `ls.firebase_url IS NULL` → the synthesizer (Section 2) returns `undefined` for `images` → the popup falls back to its existing emoji UI. Zero new code paths for the empty case.

### Index requirement (new migration)

The existing `webcam_snapshots_winners_idx (webcam_id, captured_at DESC) WHERE is_window_winner = TRUE` is partial and won't serve the "latest any-snapshot" query. A non-partial sibling is required:

```sql
-- database/migrations/20260514_webcam_snapshots_latest_idx.sql
CREATE INDEX IF NOT EXISTS webcam_snapshots_latest_idx
  ON webcam_snapshots (webcam_id, captured_at DESC);
```

Forward-only, idempotent. Apply via the same `psql` pattern used for prior migrations.

---

## Section 2: Honest payload synthesis

### 2.1 Type changes (`app/lib/types.ts`)

Widen `WebcamImages` so Windy's pre-bundled richness is optional rather than assumed. Today's shape (around `types.ts:20–35`) treats all fields as required, which forces the custom-camera path to either fabricate values or skip the field entirely.

```ts
export interface WebcamImages {
  current: {
    preview: string;             // required: the URL the popup renders
    icon?: string;               // optional: Windy provides this; custom does not (today)
    thumbnail?: string;          // optional: Windy provides this; custom does not (today)
  };
  sizes?: {                      // optional: Windy provides dimensions; custom omits
    icon: { width: number; height: number };
    preview: { width: number; height: number };
    thumbnail: { width: number; height: number };
  };
  daylight?: {                   // optional: Windy provides a daylight-only variant; custom omits
    icon: string;
    preview: string;
    thumbnail: string;
  };
}
```

The Windy import pipeline (which populates `webcams.images` from the Windy API and is in scope for the parallel `model-mosaic-integration` spec, **but is not changed by this spec**) continues to produce the full object. Widening the type does not loosen what Windy stores; it only makes the type honest about what `source = 'custom'` rows actually contribute.

### 2.2 Backend synthesizer (`app/lib/terminatorPayload.ts`)

Add a single helper colocated with the payload mapping code:

```ts
function imagesFromCustomSnapshot(url: string | null): WebcamImages | undefined {
  if (!url) return undefined;
  return { current: { preview: url } };
}
```

In the payload row mapping, replace:

```ts
images: row.images ?? undefined,
```

with:

```ts
images: row.images ?? imagesFromCustomSnapshot(row.latest_snapshot_url),
```

No fabricated sizes, no duplicated URLs across `current.icon` / `current.thumbnail` / `daylight`, no white lies. The popup reads `images.current.preview` and renders; every other field is honestly absent.

### 2.3 Wire-shape additions

The payload row (in whatever interface `terminatorPayload.ts` exports for the API response) gains these optional fields:

```ts
type LiveAssetKind = 'windy_bundle' | 'custom_snapshot' | 'custom_stream';

interface TerminatorWebcamRow {
  // ... existing fields ...
  images?: WebcamImages;
  live_asset_kind?: LiveAssetKind;
  // Populated only for source = 'custom':
  device_class?: string;                  // e.g. 'rpi-zero-2w'
  firmware_version?: string;               // e.g. '0.1.0'
  hardware_id?: string;                    // e.g. 'pi-zero-2w-tier0-jesse-house'
  latest_snapshot_captured_at?: string;    // ISO8601 UTC
}
```

Population rules in the row mapper:

| Source | `live_asset_kind` | Device fields | `latest_snapshot_captured_at` |
|--------|-------------------|---------------|-------------------------------|
| `windy` | `'windy_bundle'` | omitted | omitted |
| `custom` with snapshot | `'custom_snapshot'` | from `cameras` join | from `latest_snapshot_captured_at` SQL alias |
| `custom` with no snapshot ever | omitted (`images` also omitted → emoji fallback) | from `cameras` join (still useful for debugging) | omitted |
| Other sources (`openweather`, future) | omitted | omitted | omitted |

The `live_asset_kind` discriminator is **format-only**. Renderers switch on it to decide whether to draw `<img>`, `<video>`, etc. Hardware generation lives in the dedicated `device_class` / `firmware_version` / `hardware_id` fields — separate concerns, separate enums, no combinatorial explosion when a Gen 2 Pi or ESP32 variant lands.

### 2.4 Forward-compat path (design intent, not v1 work)

Two known upgrades will arrive after v1 ships. The above shape accommodates each without a breaking change:

| Upgrade | Wire shape | Migration impact on v1 |
|---------|-----------|------------------------|
| **Multi-resolution custom snapshots** — Pi (or server-side resizer) generates a small `preview` + full-resolution `original` at ingest time. | Populate real values into `current.icon` / `current.thumbnail` and `sizes`. Optionally add `current.original` if we want a "click for full size" affordance. | Frontend already handles partial population. Stops being `undefined`. |
| **MJPEG / WebRTC live stream** (device-protocol §8 Phase 2). | New optional field `live_stream: { url: string; protocol: 'mjpeg' \| 'hls'; started_at: string }`. `live_asset_kind: 'custom_stream'`. The `images` field stays populated as a stills fallback when the stream is offline. | Popup grows a `<video>` / MJPEG `<img>` branch keyed on `live_asset_kind === 'custom_stream'`. The synthesizer added in 2.2 still serves the offline-fallback case. |

The point: v1 sets a precedent of being explicit about what we have rather than coercing every source into the Windy-bundle shape. Same instinct that gave us `WebcamSource = 'windy' | 'custom' | 'openweather'` from day one.

---

## Section 3: Frontend popup change (intentionally minimal)

`app/components/Map/lib/webcamPopup.tsx:16–153` already reads `webcam.images?.current?.preview` (lines 19 and 81). With Section 2's synthesis, that field is populated for `source = 'custom'` rows whenever a snapshot exists, so **the popup needs zero changes for the core image fix to land.**

One small addition:

### Freshness label for `live_asset_kind === 'custom_snapshot'`

If `webcam.live_asset_kind === 'custom_snapshot'` and `webcam.latest_snapshot_captured_at` is present, render a short relative-time label near the image, e.g. *"Captured 3s ago"* or *"Captured 4m ago"* for stale captures.

- Use whatever existing relative-time formatter is already imported in the popup (or `Intl.RelativeTimeFormat` directly — no new dependencies).
- Format guidance: under 60s → seconds, 60s–60min → minutes, 60min–24h → hours, ≥24h → date. The exact thresholds are a polish detail; the constraint is "two words or fewer, no styling that competes with the image."
- For Windy rows (no `latest_snapshot_captured_at`) the label is omitted — preserves current visual density for the 99% case.

### Explicit non-changes

- **No conditional rendering keyed on `source === 'custom'`.** The popup is source-agnostic; synthesis happens server-side. The seam stays at one boundary.
- **No edits to the emoji fallback UI** (lines 119–151). Still triggers when `images` is `undefined`. With v1 in place, that only happens for custom rows with zero snapshots ever, plus any source genuinely lacking an image — both correct existing behavior.
- **No "click for full size" affordance, no recent-captures gallery, no admin status badges.** Those belong with the AR portal / admin-view work, not this fix.

The data-path / SQL changes do the heavy lifting. The frontend change is one freshness label.

---

## Section 4: Shared seam for the future admin view

The project notes explicitly call out: *"design the data query path so it can serve both the public popup AND the future admin view from the same place. Avoid two divergent code paths to the same data."*

The shared point is a **single helper module**, not a single endpoint. The terminator endpoint and the future admin endpoint legitimately want different shapes (terminator is webcam-row-shaped + geographic; admin is camera-row-shaped + ops-y), but they want the same atomic facts about each custom camera.

### New helper: `app/lib/customCameraState.ts`

```ts
export interface CustomCameraLiveState {
  device_class: string;
  firmware_version: string | null;
  hardware_id: string;
  latest_snapshot: {
    firebase_url: string;
    captured_at: Date;
  } | null;
}

// Single-camera lookup — used by the future per-row admin view
// (e.g. /admin/cameras/[id]) and any single-camera API endpoint.
export async function getCustomCameraLiveState(
  cameraId: number
): Promise<CustomCameraLiveState | null>;

// Batched lookup keyed by webcam_id — used by the future admin list
// view to avoid N+1 when rendering many cameras at once.
export async function getCustomCameraLiveStatesByWebcamId(
  webcamIds: number[]
): Promise<Map<number, CustomCameraLiveState>>;
```

### Placement note

The LATERAL join from Section 1 stays inline in `terminatorPayload.ts`. The two implementations share **vocabulary** (the columns selected, the shape returned) but not literal **SQL strings**, because their join contexts differ:

- The terminator query is already a multi-way join over `terminator_webcam_state ← webcams (← cameras, ← latest snapshot)`. Extracting one column-set from the middle of that into a separate query would mean either two round-trips or a duplicated subquery.
- The single-camera helper is the natural shape for `/admin/cameras/[id]` — pass an ID, get the live state.

If a future refactor ever wants one canonical SQL string, the natural shape is a SQL view named e.g. `custom_camera_live_state_v` that both call sites use. **Not in scope for v1** — premature unification before the second consumer exists.

### What the future admin view will and won't get from this helper

Already covered by the helper:
- `device_class`, `firmware_version`, `hardware_id` — provenance.
- `latest_snapshot` — what the camera is currently producing.

**Not covered** (the admin view will need separate queries / new fields):
- `last_heartbeat_at` (column exists on `cameras`, just not in this helper yet).
- Snapshot count over the last N hours, capture-window status, error logs.
- Operator-delivery state.

The helper is the seed of the admin-view data path, not its complete surface area. Growing it is a deliberate later step.

---

## Section 5: Error states, empty states, caching

### 5.1 Empty / edge cases

| Situation | Behavior |
|---|---|
| `source = 'custom'`, no snapshots ever | `latest_snapshot_url` is `NULL` → `images` is `undefined` → popup renders existing emoji fallback. No new code path. |
| `source = 'custom'`, snapshots exist but stale (camera offline 2 days) | Popup renders the most recent image with a `captured_at` label that visibly says "2 days ago." Staleness is surfaced, not hidden. No "offline" badge — that's admin-view territory. |
| Firebase URL 404s (rare; bucket-lifecycle deletion, manual delete) | `<img>` element fires `onerror`. The existing popup ignores `onerror`; that's a pre-existing issue independent of this fix, left out of scope. |
| Terminator pin active but `cameras` row deleted (dangling `custom_camera_id`) | `LEFT JOIN cameras` returns `NULL` → device fields are `undefined` in the payload → popup renders the snapshot (if any) without traceability metadata. Acceptable. |
| `cameras` row exists, no paired `webcams` row (impossible per schema) | Wouldn't appear in the terminator query at all (we filter on `terminator_webcam_state.active = true` which joins through `webcams`). Not reachable. |

### 5.2 Caching

- **The terminator endpoint's existing cache layer is the freshness ceiling.** Confirm during implementation that `/api/db-terminator-webcams` is not served with a long `s-maxage` (or with Redis caching > ~60s) that would mask snapshot updates. If it is, the popup-image fix doesn't really land — pins will show snapshots minutes old.
- **MosaicCanvas polls every ~60s.** Worst-case popup-image staleness is bounded by 60s + (terminator-endpoint cache TTL). Acceptable for v1.
- **No new caching layer for this fix.** Firebase URLs are immutable once written; no server-side URL caching needed. The `<img>` element + browser cache handle the rest.
- **The parallel `model-mosaic-integration` spec** introduces a Redis cache at the terminator endpoint (`terminator:current`, 300s TTL per their Section 4.1). 300s TTL would make popups visibly stale during a capture window (camera is uploading at ~1fps; popup would lag 5 minutes). **Coordination point:** when the Redis cache lands, it needs either a shorter TTL for custom rows, or invalidation triggered by `webcam_snapshots` writes, or the popup image fetched via a separate non-cached path. None of this work falls in this spec — flagged in §6.

### 5.3 Failure modes for the new code

| Failure | Scope | Response |
|---------|-------|----------|
| LATERAL subquery returns NULL for a custom row (no snapshots yet) | Per-row | `images` is `undefined`; popup falls back to emoji UI. Normal expected state for a brand-new camera. |
| `cameras` row missing for a webcam with `source = 'custom'` (schema violation) | Per-row | Device fields are `undefined`. Image still renders if `latest_snapshot_url` is non-null. Log a warning server-side; not user-visible. |
| New index `webcam_snapshots_latest_idx` not yet applied at deploy time | Tick-wide | The query still runs, but uses a sequential scan over `webcam_snapshots`. For a single-camera fleet this is invisible; flag for ops awareness during migration ordering. |

---

## Section 6: Coordination notes with the parallel `model-mosaic-integration` spec

These two specs are written and intended to be implemented in parallel. The work is largely orthogonal — different files, different layers. Coordination points:

### 6.1 `webcams.source` allowed values — **RESOLVED**

Earlier drafts of the parallel spec proposed `CHECK (source IN ('windy','pi-edge'))`. That has been reconciled in the parallel spec's current §2.7 — it now adopts `'custom'` (the existing schema value) and acknowledges the column already exists from `20260503_cameras_schema.sql`. No further work required.

### 6.2 `webcam_snapshots` column name — **RESOLVED 2026-05-14**

Earlier drafts of the parallel spec referenced `webcam_snapshots.image_url` in Phase 2 SQL pseudocode. The actual schema uses `firebase_url` (verified at `app/lib/cameraSnapshot.ts:48`). Parallel spec was updated 2026-05-14 to use `firebase_url` consistently. No further work required.

### 6.3 Terminator-endpoint Redis cache TTL — **LIVE COORDINATION**

The parallel spec adds a Redis cache at the terminator endpoint (`terminator:current`, 300s TTL). At 300s TTL, the popup image for a custom camera during a capture window will be up to 5 minutes stale, defeating the freshness label.

Resolution options (when the cache lands in the parallel spec):
1. Drop TTL to ~30s for the cache that serves custom-camera-bearing payloads.
2. Invalidate the `terminator:current` key on `webcam_snapshots` inserts for `source = 'custom'` webcams.
3. Custom rows in the response include a separate freshness side-channel (out of scope — too clever for v1).

**Not blocking this spec.** Flagged for the implementer of the parallel spec.

### 6.4 No file overlap

For the record, neither spec touches the same files:

| File | This spec | Parallel spec |
|------|-----------|---------------|
| `app/lib/terminatorPayload.ts` | yes | no |
| `app/components/Map/lib/webcamPopup.tsx` | yes | no |
| `app/lib/types.ts` (WebcamImages) | yes | no |
| `app/lib/customCameraState.ts` | new file | no |
| `database/migrations/20260514_*_latest_idx.sql` | new file | no |
| `app/api/cron/update-windy/` → `update-cameras/` rename | no | yes |
| `app/api/cron/update-cameras/lib/aiScoring.ts` | no | yes |
| `app/lib/cache.ts` | no | yes |
| `vercel.json` | no | yes |
| `daily_sunset_stats` migration | no | yes |

---

## Section 7: Testing strategy

### 7.1 Unit tests

| Module | What's tested |
|--------|---------------|
| `imagesFromCustomSnapshot()` | Given a URL → returns `{ current: { preview: url } }` only. Given `null` → returns `undefined`. No fabricated fields anywhere in the output. |
| `terminatorPayload.ts` row mapper | (a) Windy row with populated `images` → unchanged passthrough. (b) Custom row with snapshot → synthesized `images`, populated device fields, `live_asset_kind = 'custom_snapshot'`. (c) Custom row, no snapshot ever → `images` undefined, device fields present (from `cameras` join), no `live_asset_kind`. |
| `getCustomCameraLiveState()` | Existing camera with snapshots → returns full shape. Existing camera, no snapshots → `latest_snapshot: null`. Nonexistent camera → returns `null`. |
| `getCustomCameraLiveStatesByWebcamId()` | Batched query: mixed list of custom + Windy webcam IDs → only custom IDs appear in the result map. Empty list → empty map. |

### 7.2 Integration tests

| Scenario | Setup | Assertion |
|----------|-------|-----------|
| End-to-end popup image | Test DB with one `source = 'custom'` webcam + one recent `webcam_snapshots` row | `/api/db-terminator-webcams` response includes `images.current.preview = <firebase_url>` and the device fields. |
| Custom row, no snapshot | Test DB with `source = 'custom'` webcam, zero snapshots | Response omits `images`, omits `live_asset_kind`, but includes device fields from `cameras`. |
| Mixed payload | Test DB with one Windy webcam (full `images`) and one custom webcam (snapshot) | Both rows render; Windy row has `live_asset_kind = 'windy_bundle'`, custom row has `live_asset_kind = 'custom_snapshot'`. |
| Latest-snapshot index used | `EXPLAIN ANALYZE` of the terminator query with non-trivial `webcam_snapshots` row count | Plan uses `webcam_snapshots_latest_idx`, not a sequential scan. |

### 7.3 Manual verification before declaring done

- Click the live Tier 0 Pi pin on `https://www.sunrisesunset.studio` during a capture window. Popup shows the actual camera image, not the emoji fallback.
- Confirm the "Captured Ns ago" label shows a short interval during an active window.
- Confirm freshness ceiling: image age does not exceed (MosaicCanvas poll interval) + (terminator endpoint cache TTL) + (a few seconds of network slack).
- Click a Windy pin. Popup behaves exactly as it does today — no regression.
- Click a hypothetical custom pin that has never uploaded (or temporarily delete the camera's snapshots in a test environment). Popup shows the emoji fallback.

### 7.4 Out of scope

- The Pi firmware itself — separate repo (`sunset-cam-firmware`), no changes needed for this spec.
- The admin / fleet status view — separate later spec, will consume the `customCameraState` helper.
- The Windy import pipeline — unchanged.

---

## Section 8: Rollback levers

This change is purely additive on the wire (new optional fields), additive in the SQL (one index, one extra `LATERAL` join in one query), and additive in types (widening). Rollback is just reverting the commit(s); no data migration to undo.

The new index `webcam_snapshots_latest_idx` can be dropped safely at any time — no foreign-key or constraint dependencies. Leaving it in place after a code rollback costs only disk space (~tens of MB at fleet scale).

No env-var feature flag is included. The change is small enough and reversible enough that a flag would be ceremony.

---

## Files changed (estimate)

**New files:**
- `database/migrations/20260514_webcam_snapshots_latest_idx.sql` — one `CREATE INDEX IF NOT EXISTS`.
- `app/lib/customCameraState.ts` — single-camera + batched lookups for the shared admin/popup seam.

**Modified files:**
- `app/lib/terminatorPayload.ts` — extend SELECT, add `LEFT JOIN cameras`, add `LEFT JOIN LATERAL`, add `imagesFromCustomSnapshot()`, extend row-mapper output with `live_asset_kind` + device fields + `latest_snapshot_captured_at`.
- `app/lib/types.ts` — widen `WebcamImages` (`current.icon` / `current.thumbnail` / `sizes` / `daylight` → optional). Add `LiveAssetKind` and the new optional payload row fields to whatever response interface is exported.
- `app/components/Map/lib/webcamPopup.tsx` — render the "Captured Nm ago" label conditional on `live_asset_kind === 'custom_snapshot'` and `latest_snapshot_captured_at` being present.

**Tests added per Section 7.**

**Migration apply step:** run `20260514_webcam_snapshots_latest_idx.sql` against the prod Neon DB. Forward-only, `IF NOT EXISTS` makes it idempotent.

---

## Open numerical decisions (small)

- **Relative-time formatter thresholds for the freshness label.** Suggested: `<60s → "Ns ago"`, `<60min → "Nm ago"`, `<24h → "Nh ago"`, `≥24h → absolute date`. Implementer's call; not load-bearing.
- **Cache TTL coordination with the parallel spec's Redis layer** — see §6.2. Decision lives in that spec's implementation.
