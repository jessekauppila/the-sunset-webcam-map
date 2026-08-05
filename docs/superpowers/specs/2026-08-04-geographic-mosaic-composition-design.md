# Geographic Mosaic Composition Engine — Design

**Date:** 2026-08-04
**Status:** Approved direction (brainstormed with Jesse at the kiosk wall, first dual-monitor session)
**Replaces:** `app/components/MosaicCanvas/` (both kiosk pages and the main-page mosaic view modes)

## Goal

One composition algorithm that renders sunrise/sunset webcam mosaics on every surface
— the two portrait kiosk monitors, the main site's mosaic view modes, and any browser
tab used for remote troubleshooting. The screen always reads as a north-south axis;
what changes with population is how literally geography maps to position.

## Core directives (from Jesse, on-glass)

1. Each screen shows only sunrises or only sunsets.
2. North at top, south at bottom; west at left, east at right within a row.
3. Tile size follows quality rating — but never below the legibility floor
   (~100px height on the 27" 1080×1920 panels) and never upscaled past what the
   source image supports (~1.5×).
4. Too many images → drop the worst-rated rather than crowd or shrink.
5. Sparse pools breathe: tiles sit at latitude-proportional positions, and the
   empty space is information. Dense pools pack: spacing serves the images,
   ordering still carries the geography.
6. A toggleable setup mode overlays lat/lon per tile, the feed label
   (SUNRISE/SUNSET), and an orientation arrow — for physical installs and remote
   debugging. No hand-rolled label pages on the Pi.
7. One module decides which model's score drives sizing. Model upgrades must
   propagate to composition by changing that one file.

## Architecture

```
app/lib/qualitySignal.ts          — THE quality signal (one place, see below)
app/components/GeoMosaic/
  engine/
    percentileSize.ts             — scores → percentiles → tile px heights
    bandRows.ts                   — N→S greedy row formation, W→E within row
    distributeSpace.ts            — leftover-space allocation (the sparse/dense blend)
    overflow.ts                   — drop lowest-percentile until layout fits
    compose.ts                    — orchestrates the above; pure: (webcams, viewport, config) → Layout
  GeoMosaic.tsx                   — dumb renderer: Layout → <canvas> (+ DOM setup overlay)
  types.ts
```

`compose()` is a pure function returning a `Layout` (tile rects + metadata + dropped
list). All visual behavior is testable without a browser. `GeoMosaic.tsx` only draws.

### qualitySignal.ts

```ts
getQualityScore(webcam): number | null   // today: aiRatingRegression ?? null
```

- Today's resolution: `aiRatingRegression` (live v4 ONNX regression, 1–5). Nothing else.
  The legacy `aiRating` fallback chain dies with MosaicCanvas.
- `null` (unscored) tiles are still shown (Jesse: "look at them all") at the median
  percentile (0.5). Gating unscored images is a possible future, not now.
- When v5 ships, this file changes; every surface follows.

## Algorithm

Input: webcam pool for one feed (sunrise or sunset), viewport W×H, config.

1. **Score → percentile.** Rank scored webcams by `getQualityScore`; percentile ∈ [0,1].
   Unscored → 0.5. Percentile (not absolute score) drives size, so the visible
   hierarchy survives nights when all scores cluster.
2. **Preferred height.** `h = FLOOR + (CEIL − FLOOR) × percentile`, then clamped by
   the upscale ceiling: `h ≤ sourceHeight × UPSCALE_MAX`. Width follows source aspect.
   - `FLOOR = 100px` (legibility, provisional), `CEIL = 300px`, `UPSCALE_MAX = 1.5`.
3. **Row formation** (`bandRows`). Sort N→S by latitude; fill rows greedily left to
   right until the next tile would exceed viewport width; start a new row. Sort each
   completed row W→E by longitude. (Rows are emergent latitude bands — ordering is
   strict, band edges adapt to tile sizes.)
4. **Overflow** (`overflow`). If stacked row heights (at preferred sizes) exceed H,
   drop the single lowest-percentile tile and re-form rows; repeat until it fits.
   Dropped tiles are reported in the Layout (setup mode shows the count).
5. **Space distribution** (`distributeSpace`) — the sparse↔dense blend, with no mode
   switch: after packing, leftover vertical space `S = H − Σ rowHeights` is allocated
   to the gaps between rows (plus top/bottom margins) **proportional to the latitude
   gaps** between adjacent rows' mean latitudes, anchored to a fixed world window
   (`LAT_WINDOW = [70°N, 60°S]`, config). Dense pool → S≈0 → packed quilt. Sparse
   pool → large S → tiles sit at latitude-true positions with honest emptiness
   between. The same rule applies horizontally within each row using longitude
   gaps, anchored to the feed pool's own min/max longitude (the terminator band
   moves daily, so longitude uses a relative window — latitude uses the fixed
   world window). One rule, continuous behavior, no overlaps possible.
6. **Growth when sparse.** Before distributing space, compute one uniform growth
   factor `k = min(H / Σ preferredRowHeights, COMPOSITION_MAX_GROWTH)` and apply it
   to all preferred heights, re-clamping each tile at its upscale ceiling (step 2).
   Ceilings win over fill — option (c): grow, never past ~1.5× source, and whatever
   space growth can't honestly fill goes to geographic breathing (step 5).

### Setup mode

`?setup=1` on any surface adds a DOM overlay (not canvas): per-tile `lat, lon` (+
score/percentile), feed label (SUNRISE/SUNSET), THIS-WAY-UP arrow, live tile count and
dropped count. This replaces the local label HTML pages currently on the kiosk Pi.

### Error handling

- Image fails to load → tile skipped for this render (no black boxes); skipped count
  in Layout; retried next refresh.
- Empty pool → black screen with a small dim feed label (so an all-night sunrise
  screen doesn't look broken).
- Score service missing/null-heavy → everything renders at median size; layout never
  throws for lack of scores.

## Surfaces & migration

1. Engine + renderer built and unit-tested.
2. `/kiosk/sunrise` and `/kiosk/sunset` swap to `GeoMosaic` (kiosk tunables from
   `masterConfig.ts`).
3. Main page's `sunrise-mosaic` / `sunset-mosaic` view modes swap to `GeoMosaic`
   (same engine, page viewport) — this is the remote troubleshooting surface.
4. `app/components/MosaicCanvas/` deleted, same effort, after both swaps verified.
   No long coexistence.

## Config (all in masterConfig.ts, all tweakable)

`COMPOSITION_TILE_FLOOR_PX = 100`, `COMPOSITION_TILE_CEIL_PX = 300`,
`COMPOSITION_UPSCALE_MAX = 1.5`, `COMPOSITION_LAT_WINDOW = [70, -60]`,
`COMPOSITION_MAX_GROWTH = 2.0` (cap on the sparse uniform growth factor),
plus existing kiosk cadence constants (unchanged).

## Testing

- Pure-function unit tests: percentile mapping (incl. all-null, all-equal scores),
  greedy row formation (ordering invariants: every row's mean lat ≥ next row's;
  W→E within row), space distribution (dense → ≈0 gaps; single tile → lands at
  latitude-true y; proportionality), overflow (drops exactly lowest percentiles,
  terminates, never drops below one tile), upscale ceiling.
- Renderer smoke tests (jsdom): renders without crash, setup overlay presence.
- Visual verification: browser at 1080×1920 via `?setup=1`, then on-glass at the wall.

## Out of scope

- Gating unscored/non-regression images (future toggle).
- Map globe view, popup, gallery — untouched.
- Kiosk Pi OS/launcher changes (label pages retire only after setup mode ships).
- Manual-rating integration and v5 training (separate queued projects).
