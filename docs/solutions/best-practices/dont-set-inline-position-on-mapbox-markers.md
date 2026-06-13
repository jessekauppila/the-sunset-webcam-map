# Don't set inline `position` on a Mapbox marker element

**Date:** 2026-06-13
**Area:** Map / Mapbox GL markers (frontend)

## The trap

A marker wrapper set `position: relative` in its **inline** style (a reflex to anchor a
child health badge). But Mapbox positions every marker for you via
`.mapboxgl-marker { position: absolute }` + a per-marker `transform`. An inline `position`
on the marker element **overrides** Mapbox's absolute positioning, dropping every marker
(Windy *and* custom) out of the map's coordinate space into **normal document flow** — they
render as a vertical stack off the globe instead of sitting on their lat/lng.

This shipped in **#64** and then **regressed**: the fix lived in an unmerged branch
(`hotfix/marker-positioning`) with **no learning doc**, so when #64 merged to `main` the bug
came back and the fix was orphaned. It has now broken at least twice — hence this doc.

## Why it's sneaky

- The markers still **render**, just in the wrong place, so it looks like a CSS layout glitch
  rather than a positioning-system conflict.
- "I need `position: relative` to anchor the badge" is a reflexive habit — but Mapbox's
  `absolute` + `transform` already make the marker element a **containing block**, so an
  absolutely-positioned child badge anchors to it fine **without** re-positioning the root.
- The damage is global (every marker) but the cause is one innocuous line deep in
  `createMarkerElement`.

## The rule

**Never set `position` (relative/absolute/etc.) in the inline style of a Mapbox marker
element.** Mapbox owns that element's positioning. To anchor a child: rely on Mapbox's
`absolute` + `transform` as the containing block, or nest the child inside an **inner**
element you fully control — never re-position the marker root.

## Guardrail

Keep the regression test `app/components/Map/hooks/createMarkerElement.test.ts`, which asserts
the marker wrapper sets **no inline `position`**. If a future change re-adds one, the test
fails before it ships.

## How it got fixed (both times)

Remove the inline `position: relative` from the marker wrapper in
`useSetWebcamMarkers.tsx → createMarkerElement`. The health badge keeps anchoring via Mapbox's
containing block. (Commit `03bb4b471`, cherry-picked to `main` as `815bc6a5d` on 2026-06-13.)
