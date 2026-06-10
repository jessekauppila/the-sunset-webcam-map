# Per-Camera Detail Page — Design Spec (Sub-project B)

**Date:** 2026-06-10
**Status:** Approved (brainstorm), pending implementation plan
**Branch / worktree:** `worktree-camera-detail` (stacked on `worktree-my-cameras-map` / PR #64)

## Context

Sub-project A (PR #64) shipped the owner-only "My Cameras" map view: a globe of the
owner's custom cameras color-coded by window-relative health, with a click-popup. A
deliberately deferred the popup's **"View all data →"** seam to this sub-project.

**B is that seam's destination:** a per-camera **detail page** — "get all the data from
this one camera." It is the owner-facing *troubleshooting* depth (sub-project C will
later fork a public/consumer variant from the same page). Per the A→B→C plan, B is
**owner-only**.

This spec is stacked on A's branch because B reuses A's `cameraHealth.ts` and
`CameraHealthHeader`, and its entry point is A's popup. When A (PR #64) merges, B
rebases onto `main`.

## Goal

Give the owner a single scannable page per camera showing its identity + health, its
best frames, and its full chronological image history — reusing existing snapshot and
leaderboard infrastructure rather than rebuilding it.

## Non-goals (deferred)

- Public / consumer-facing variant of this page (sub-project C).
- Auto-export to Google Photos / iCloud / Instagram (sub-project C).
- Editing camera config, remote wake, or any device commands.
- Per-frame rating/curation UI (the page is read-only; rating lives elsewhere).

## Layout (approved: vertical stack "A")

One scannable column, mobile-friendly:

```
┌─────────────────────────────┐
│ [latest frame ✓] sunset-cam-1 · Live      header (server)
│   snap 12m · hb 3m · fw 0.4.2 · sunset
├─────────────────────────────┤
│ ★ BEST FROM THIS CAMERA               best strip (client)
│ [▦][▦][▦][▦][▦] →
├─────────────────────────────┤
│ ALL CAPTURES · newest first           history grid (client)
│ [▦][▦][▦][▦] … load more ↓
└─────────────────────────────┘
```

## Architecture

### 1. Route & gating
- `app/cameras/[id]/page.tsx` — App-Router **server component**. `id` = `cameras.id`.
- Owner-gated server-side: resolve the session via `auth()` and check `isOwner`
  (`app/lib/owner.ts`). Non-owner (or unauthenticated) → `redirect('/')`. Unknown /
  malformed id → `notFound()` (404).
- Pattern mirrors `app/models/[slug]/page.tsx` (async server component, `params` as a
  Promise, server-side data fetch — no client fetch for the header).

### 2. Header (server-rendered)
- New server helper `fetchCameraDetail(cameraId: number): Promise<CameraDetail | null>`
  in `app/lib/cameraDetail.ts`. Queries the single camera (join `webcams` for `title`,
  lateral latest `webcam_snapshots` for the newest frame), returning a richer object
  than A's `MyCameraMarker`:
  `{ cameraId, webcamId, title, hardwareId, deviceClass, firmwareVersion, lat, lng,
     phase, status, registeredAt, lastHeartbeatAt, lastSnapshotAt, latestSnapshotUrl,
     health, isInWindowNow }`.
- Health + window are computed by **reusing A's `cameraHealth.ts`**
  (`getMostRecentExpectedWindow` + `computeCameraHealth` + `isInWindowNow`) — no
  duplicated logic. Returns `null` when no camera with that id exists.
- A `CameraDetailHeader` component renders the latest frame with the health ring
  (reusing `healthVisual` from `app/components/Map/cameraHealthVisual.ts`), the title +
  health label, and vitals chips. Relative timestamps reuse A's `relativeTime`
  (exported from `CameraHealthHeader.tsx`).

### 3. Best strip (client)
- `CameraBestStrip` client component fetching `/api/leaderboards?webcam_id={webcamId}`.
- Requires a **new optional `webcam_id` filter param** on `app/api/leaderboards/route.ts`
  (parse param → add `s.webcam_id = {id}` to the WHERE clause; response shape unchanged;
  route stays public). When absent, behavior is unchanged.
- Renders a horizontal scroller of the top frames (ranked by the existing
  `COALESCE(llm_quality, ai_regression_score)` sort), each thumbnail showing its Claude
  quality via the existing `ClaudeVerdictDisplay`.

### 4. All-captures grid (client)
- `CameraImageHistory` client component paginating
  `/api/snapshots?webcam_id={webcamId}&mode=archive&limit=&offset=` — **already exists**
  (public, newest-first, returns `{ snapshots, total, limit, offset }`).
- Renders a responsive grid reusing the existing `SnapshotCard` for each frame, with a
  "Load more" button advancing `offset` until `total` is reached.

### 5. The entry link (fills A's seam)
- Add an optional `cameraId?: number` to `WindyWebcam` (`app/lib/types.ts`) and set it in
  `myCameraToWindyWebcam` (`app/lib/myCameras.ts`) from `MyCameraMarker.cameraId`.
- In A's `CameraHealthHeader` (`app/components/MyCameras/CameraHealthHeader.tsx`), render
  a **"View all data →"** link to `/cameras/{webcam.cameraId}` **only when `cameraId` is
  set** (so terminator/Windy popups are unaffected).

### 6. Identity & edge states
- URL identity is `cameras.id` (stable, owner's device). The page resolves `cameras.id`
  → `webcam_id`; the best/history client sections receive `webcamId`.
- **Never-reported camera** (`webcam_id` null): header shows "Never reported"; best strip
  and history render empty states ("No captures yet") without firing webcam_id-less
  queries.
- **Unknown id** → 404. **Non-owner** → redirect to `/`.

## Data flow

```
/cameras/[id] (server, owner-gated)
  └─ fetchCameraDetail(id)  ── SQL + cameraHealth.ts ─▶ CameraDetail ─▶ CameraDetailHeader
       └─ webcamId ─▶ <CameraBestStrip webcamId>     ─▶ /api/leaderboards?webcam_id=
       └─ webcamId ─▶ <CameraImageHistory webcamId>  ─▶ /api/snapshots?webcam_id=&mode=archive
```

## Components & files

**Create**
- `app/cameras/[id]/page.tsx` — owner-gated server page; composes header + client sections.
- `app/lib/cameraDetail.ts` — `fetchCameraDetail` + `CameraDetail` type.
- `app/lib/cameraDetail.test.ts`
- `app/components/CameraDetail/CameraDetailHeader.tsx` — server-friendly header.
- `app/components/CameraDetail/CameraDetailHeader.test.tsx`
- `app/components/CameraDetail/CameraBestStrip.tsx` — client; leaderboard strip.
- `app/components/CameraDetail/CameraBestStrip.test.tsx`
- `app/components/CameraDetail/CameraImageHistory.tsx` — client; paginated archive grid.
- `app/components/CameraDetail/CameraImageHistory.test.tsx`

**Modify**
- `app/api/leaderboards/route.ts` — add optional `webcam_id` filter param.
- `app/api/leaderboards/route.test.ts` — cover the new filter.
- `app/lib/types.ts` — add optional `cameraId?: number` to `WindyWebcam`.
- `app/lib/myCameras.ts` — map `cameraId` through.
- `app/components/MyCameras/CameraHealthHeader.tsx` — render the "View all data →" link.
- `app/components/MyCameras/CameraHealthHeader.test.tsx` — link present when `cameraId` set, absent otherwise.

## Reuse summary

| Need | Reuse |
| --- | --- |
| Health + window logic | A's `app/lib/cameraHealth.ts` (unchanged) |
| Health color/badge/label | A's `cameraHealthVisual.ts` |
| Relative timestamps | A's `relativeTime` (from `CameraHealthHeader.tsx`) |
| Image history API | existing `GET /api/snapshots?webcam_id=&mode=archive` |
| Snapshot thumbnail | existing `SnapshotCard` |
| Quality display | existing `ClaudeVerdictDisplay` |
| Leaderboard ranking | existing `/api/leaderboards` (+ one filter param) |
| Owner gating | existing `auth()` / `isOwner` (`app/lib/owner.ts`) |
| Page route pattern | existing `app/models/[slug]/page.tsx` |

## Testing strategy

Vitest, following existing patterns:
- **`fetchCameraDetail`** (highest value): row→`CameraDetail` mapping, health via the real
  `cameraHealth.ts`, null for unknown id, null-`webcam_id` (never-reported) shape. DB
  mocked per the `@/app/lib/db` pattern.
- **`/api/leaderboards` filter**: with `webcam_id` the query restricts to that webcam;
  without it, behavior is unchanged (regression guard).
- **Page gating**: non-owner redirects, unknown id 404s, owner renders (auth/db mocked).
- **`CameraImageHistory`**: renders snapshots, "Load more" advances offset, empty state
  when none.
- **`CameraBestStrip`**: renders ranked frames, empty state.
- **`CameraHealthHeader`**: "View all data →" link present with `cameraId`, absent without
  (Windy popups unaffected).

## Open implementation questions (for the plan, not blockers)

- Whether `CameraImageHistory` should reuse the existing `useArchiveSnapshots` hook /
  snapshot store or fetch directly with local state (lean dedicated fetch likely simpler
  and avoids store coupling).
- Exact vitals shown in the header chips (firmware/device-class may be null for some
  cameras — render only present fields).

## Decisions captured from brainstorm

- B is **owner-only**, stacked on A's branch; C later forks a public variant.
- Layout **A** (vertical: header → best strip → full grid).
- Page **queries the DB directly server-side** (no new header API route); best/history are
  **lean dedicated client components**, not the heavier `SnapshotConsole`.
- URL identity is **`cameras.id`**.
- The "View all data →" link is added to A's `CameraHealthHeader`, gated on `cameraId`.
