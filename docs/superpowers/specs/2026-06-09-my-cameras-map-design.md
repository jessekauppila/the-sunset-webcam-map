# "My Cameras" Map View — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorm), pending implementation plan
**Branch / worktree:** `worktree-my-cameras-map`

## Context

The product today shows a globe of Windy webcams (plus some custom cameras) driven
by the terminator/sunset pipeline. Jesse is also running his own custom IoT
cameras (`sunset-cam-0`, `sunset-cam-1`, …) registered as `webcams.source='custom'`.
There is no dedicated surface for seeing, at a glance, **which of his own cameras
are working and which are not**.

This spec covers **Sub-project A** of a larger vision. The full vision decomposes into:

- **A — "My Cameras" map view** *(this spec)*: a globe like today's, but showing only
  the user's own cameras, color-coded by health, with a camera list and an
  in-range/all toggle. A troubleshooting board: "what's alive, what's broken?"
- **B — Per-camera detail page** *(future spec)*: "get all the data from this camera"
  — its own leaderboard + full image history + health detail.
- **C — Consumer delivery + owner view** *(future spec)*: owner-facing version of B
  plus auto-export to Google Photos / iCloud / Instagram.
- **Kickstarter / selling**: business layer on top of C; not an engineering spec.

The deliberate insight: A and B *are* the consumer infrastructure. Building the
troubleshooting tool first is not a detour — it is the consumer backend with the
owner's face on it first.

## Goal

Give the owner a single, login-gated view that answers "are all my cameras working?"
in one glance, reusing the existing map, marker, popup, auth, and sunset
infrastructure rather than forking it.

## Non-goals (explicitly deferred)

- **Remote camera wake** ("turn the cameras on when the view opens"). The current
  model is device-initiated (devices POST snapshots/heartbeats; there is no
  server→device push channel). We show the freshest *available* snapshot instead.
  Real remote-wake is its own later slice.
- **Per-camera detail page** (Sub-project B). This view links toward it with a stub
  affordance but does not build it.
- **Consumer / export integrations** (Sub-project C).

## Existing infrastructure this builds on

| Concern | Reused asset |
| --- | --- |
| View switching | `ViewMode` union + `MapMosaicModeToggle.tsx`; `MainViewContainer.tsx` switch |
| Globe / map render | `SimpleMap.tsx` → dynamic `GlobeMap.tsx` (Mapbox + Deck.gl) |
| Markers | Existing custom-snapshot thumbnail markers (`useSetWebcamMarkers.tsx`) |
| Click popup | Existing map popup UI (`RatingCard` / popup shown by the marker hook) |
| Auth | NextAuth v5 + Google OAuth, owner allow-list (`auth.ts`, `app/lib/ownerEmails.ts`) |
| Client "am I owner?" | `useIsOperator()` hook |
| Server route guard | `requireOwner()` (`app/lib/owner.ts`) |
| Sunrise/sunset windows | `app/lib/simple-sunset.ts` + terminator libs |
| Data model | `cameras`, `webcams` (`source='custom'`, `custom_camera_id`), `webcam_snapshots` |
| State pattern | Zustand stores (`useAllWebcamsStore` / `useLoadAllWebcams` as the template) |

## Design

### 1. Where it lives & who sees it

- Add a new `ViewMode` value `'my-cameras'` to the union in `MainViewContainer.tsx`.
- Render a third toggle button ("My Cameras") in `MapMosaicModeToggle.tsx`, **only when
  `useIsOperator()` returns true**. The button is absent when logged out.
- Add a `case 'my-cameras'` in `MainViewContainer.tsx` that mounts the existing
  `SimpleMap` with a `my-cameras` data source (not a new map component).
- If the user logs out while this view is active, fall back to `'globe'` (mirrors the
  existing operator-only tab fallback behavior in `HomeClient.tsx`).
- No new route; it is a view mode within the current page shell.

### 2. Data source & health (the core)

New **owner-gated** API route: `GET /api/my-cameras`, guarded by `requireOwner()`
(returns 401 when unauthenticated, 403 when not an owner). It returns every
`source='custom'` camera with a server-computed **health** field.

**Health is window-relative**, not wall-clock — because these cameras are
duty-cycled and a healthy camera is asleep (no recent heartbeat) at midday. A fixed
"heartbeat < 15m" threshold would mark every working camera red at noon.

For each camera:

1. Derive its **most recent expected capture window** from `lat/lng` +
   `phase_preference`, using the existing sunset logic (`simple-sunset.ts` / terminator).
2. Compare against `last_heartbeat_at` and the latest `webcam_snapshots.captured_at`:

| State | Color | Meaning |
| --- | --- | --- |
| **Live** | 🟢 green | Snapshot delivered during the most recent expected window (or actively delivering now) |
| **Stale** | 🟠 amber | Heartbeat for that window, but **no snapshot landed** (reachable, not capturing/uploading) |
| **Offline** | 🔴 red | Missed the most recent window entirely (no heartbeat, no snapshot) |
| **Never reported** | ⚪ grey | Registered, never sent any data |

A green camera sitting in daylight reads as "healthy, sleeping until its next window" —
the desired behavior. **Stale** (heartbeat-but-no-snapshot) is the most useful
"device alive but something's wrong" signal and is expected to be the most common
real failure.

**Per-camera payload:** `id, title, lat, lng, health, lastHeartbeatAt,
latestSnapshotUrl, latestSnapshotAt, phase, isInWindowNow`.

**Client state:** a small `useMyCamerasStore` (Zustand) + `useLoadMyCameras` hook,
mirroring `useAllWebcamsStore` / `useLoadAllWebcams`.

### 3. Map & markers (reuse)

- The view mounts the existing `SimpleMap` → `GlobeMap`.
- Markers reuse the current custom-snapshot thumbnail markers, **extended with the
  chosen health-ring style**: a colored glow ring + a small corner badge
  (✓ live / ! stale / × offline / ? never reported), driven by `health`.
- "Never reported" cameras (no thumbnail) render a 🛰️ placeholder marker.
- This health ring is the *only* change to marker rendering.

### 4. Controls & list panel (Layout A — map-first + collapsible list)

- **Top summary chips:** e.g. `3 live · 1 stale · 1 off` — the instant
  "is everything OK?" readout.
- **All / In-range toggle:** "In-range" filters to cameras where `isInWindowNow` is
  true; "All" shows everything (ring color still encodes health). **Default: All.**
- **Docked camera list:** a narrow, collapsible right-side panel listing cameras
  **sorted worst-health-first** (offline → stale → never reported → live). Each row:
  health dot, camera name, and a short status string ("offline 2d", "stale 4h",
  "live"). Clicking a row flies the globe to that camera and opens its popup. The
  panel collapses for a pure-globe view.
- The toggle controls **which cameras appear**; the ring color always encodes
  **health** — two independent dimensions.

### 5. Click → camera popup

Reuse the **existing** map popup UI (the same one used elsewhere — "see them like in
our other map's UI"), showing the live/latest snapshot. Add a small **health header**:
the health state + relative timing ("last snapshot 4h ago", "last heartbeat …"). Include
a stub **"View all data →"** affordance — non-functional for now; it is the seam where
**Sub-project B** (per-camera detail/leaderboard) will plug in. No remote-wake button.

## Testing strategy

Vitest, following existing patterns (`SimpleMap.test.tsx`, marker-hook tests, etc.):

- **Health computation (highest coverage — pure function):**
  - each of the four states from representative inputs;
  - the duty-cycle edge case: healthy-but-asleep-at-noon stays **green**;
  - window-boundary transitions (just before / during / just after a window);
  - "Stale" specifically: heartbeat present, snapshot absent for the window.
- **API route:** owner-gating (401 unauthenticated, 403 non-owner) and payload shape.
- **Components:** toggle button hidden when `!isOperator`; list sorts worst-health-first;
  summary chip counts correct; In-range filter uses `isInWindowNow`.

## Open implementation questions (for the plan, not blockers)

- Exact reuse seam in `SimpleMap`/marker hook for feeding the my-cameras dataset vs.
  the terminator dataset (parameterize existing hook vs. a thin parallel hook).
- Whether health is computed live per request or cached (the existing
  `update-cameras` cron and `customCameraState.ts` may offer a place to precompute).
- Precise definition of "most recent expected window" when a camera has both
  sunrise and sunset preferences.

## Decisions captured from brainstorm

- Marker health encoding: **colored ring + corner badge** (Style A), chosen over a
  text-pill style.
- Health model: **window-relative**, four states, with **Stale** = heartbeat-without-snapshot.
- Layout: **A — map-first with a collapsible, worst-health-first camera list** and a
  top summary bar.
- Login-gated: the toggle button is hidden when logged out; data route is
  `requireOwner()`-guarded.
- Click popup: **reuse the existing popup**, add only a health header + a stub
  "View all data →" link.
- In-range/All toggle **defaults to All**.
