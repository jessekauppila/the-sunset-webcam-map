# Mosaic v2 phase 2 — resolved composition decisions

**Date:** 2026-09-01
**Status:** All decisions settled. Ready for implementation planning.
**Parent spec (binding):** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md`

This addendum records only what the parent spec left open for phase 2. The
parent spec's fixed directives, knob list, phasing, and testing bar are
unchanged.

---

## Measured facts that shaped these decisions (2026-09-01)

Pulled from the three real `kiosk_scenes` rows, not assumed:

| scene | pool | signal present | gate passers |
|---|---|---|---|
| 1 — June solstice, 12:00 UTC | 9 sunset | **Claude only** (`llmQuality`, `llmIsSunset`) | 6/9 |
| 2 — Equinox full glass | 125 sunrise / 95 sunset | **Claude only** | 33/125, 24/95 |
| 3 — first live capture | 21 sunrise / 42 sunset | **ML only** (`aiRatingBinary`, `aiRatingRegression`) | 2/21, 4/42 |

**The two reconstructed historical scenes carry no ML head scores at all**, and
the live capture carries no Claude scores. Reconstruction rebuilds the pool
from `webcam_snapshots` history joined to current `webcams` metadata, and the
ML columns are not part of that join.

Consequence: a model-only quality signal renders both seed scenes completely
unscored — every tile gate-fails, everything pins to the floor, and the flood
scene becomes a uniform carpet that tells the operator nothing. The
`qualitySource` seam below is therefore **required for phase 2 to be judgeable
at all**, not a future nicety.

### The seed scenes are not terminator pools — flagged, not fixed

Measuring solar altitude for every camera at its own capture time:

| pool | median sun altitude | terminator band? |
|---|---|---|
| live capture · sunset (42) | **−12.4°** | **yes** — dead on the configured −13° |
| live capture · sunrise (21) | −15.8° | yes |
| equinox flood · sunrise (125) | **+43.6°** | no — local mid-morning |
| equinox flood · sunset (95) | **−49.9°** | no — local ~01:30 |
| solstice sparse (9) | scattered, −80° to +71° | no |

The live capture lands on the configured band, which validates both the
capture pipeline and the measurement. **Both reconstructed historical scenes
do not.** Their capture timestamps *are* within the ±45 min reconstruction
window of `represents_at`, yet the cameras were nowhere near the terminator —
each pool sits roughly 7 hours off in local solar time, in opposite
directions. 7h ≈ US Pacific offset in March, which suggests a timezone skew
somewhere in reconstruction or in `webcam_snapshots.captured_at`, but that is
a hypothesis and has not been verified.

Consequence for phase 2: layout and sizing can still be judged on those
scenes, but anything gate-, geography-, or twilight-dependent cannot — the
frames are daytime and midnight. The session's "flip between the two seed
scenes" done-signal is therefore only partly available; the live capture is
the trustworthy pool. **Chasing the reconstruction skew is its own bug, out of
scope here.**

Latitude spans nearly the full globe in every scene (−81° to +71°), which is
what makes the latitude axis carry real information. Longitude spread is
wider than first assumed — p10–p90 is roughly 40–50° — and **scene 1 wraps the
dateline** (−177.9° to +76.4°), so any longitude mapping must be
circular-mean-relative rather than a raw min/max normalization.

---

## 1. Quality signal — ML, behind a source seam

v2 owns its own `qualitySignal.ts` returning **two separate values**,
`{ passes: boolean, score: number | null }` with `score` normalized to [0,1].
Composing them into one number was v1's bug; they never merge again.

A `qualitySource` enum knob selects the interpretation:

- `auto` (default) — ML heads when present, else Claude, else unscored.
- `model` — `aiRatingBinary` gates, `aiRatingRegression` sizes.
- `llm` — `llmIsSunset` gates (a boolean, so `gateThreshold` does not apply),
  `llmQuality` sizes.

Whichever ML model most recently scored a frame is what `model` reads; the
schema stores one regression score per webcam, overwritten each run. Choosing
*between two ML model versions* on the glass would need new columns plus
scorer work — out of scope, recorded here as a known limit.

## 2. `gateThreshold` unit conversion

The knob is a probability in [0,1] (default 0.55); stored ratings are on the
1–5 scale. v2 converts internally: `ratingGate = 1 + t * 4`. This is the
normalized-vs-raw trap that produced the 35k-rows-zero-positives bug, so it
gets a dedicated unit test.

## 3. Every camera is shown; no camera-level rating

All cameras in the pool are composed. A camera missing a per-frame detection
score is treated as not-a-passer for *sizing* — it renders at the floor rather
than being sized up as though it were a great sunset — but it is never removed
on that basis. Under the default `showAtFloor` policy nothing disappears.

Excluding a camera that *consistently* draws false positives from the model is
a separate, camera-level reputation concept. It is **not** in phase 2 and not
the same thing as a missing per-frame score. Recorded as a future workstream.

## 4. `failedCamPolicy: showIfRoom`, made concrete

Place all gate-passers first, then add gate-failers at floor size in
descending-score order, each only if it fits the current arrangement without
pushing the composition past the panel. Deterministic; no randomness.

## 5. `maxTiles`

A hard ceiling on total tile count, passers and failers alike — the legibility
limit for the equinox flood. Applied *after* the visibility policy and *before*
arrangement: keep passers by descending score, then failers by descending
score. `0` means unlimited.

Distinct from #4: `failedCamPolicy` decides what happens to gate-failers as a
class and is space-driven; `maxTiles` is a numeric cap on everything. They
chain — policy picks the candidate set, `maxTiles` truncates it.

## 6. Arrangement — `anchorRelax`

### 6a. The horizontal axis is depth into twilight, not longitude

Decided 2026-09-01 after building an interactive mockup on real scene data
(`.superpowers/brainstorm/`). Three candidates were compared:

- **A — X = order only.** Tiles packed west→east; horizontal distance means
  nothing but sequence. A stack of shelves.
- **B — X = true longitude.** Rejected. Measured `corr(lat, lon)` across the
  real pools runs −0.37 to −0.91: the terminator is a *tilted line*, so
  longitude is largely a restatement of latitude and X collapses into a
  diagonal ribbon with two empty corners. The solstice pool is worse still —
  254° of longitude span with circular clustering R = 0.30, i.e. it wraps the
  globe and no longitude→X mapping is meaningful.
- **C — X = depth into twilight (CHOSEN).** X anchors to the sun's actual
  altitude at that camera. This is the same quantity that *defines* the pool:
  `masterConfig.TERMINATOR_SUN_ALTITUDE_DEG = -13`, with cameras gathered
  within `SEARCH_RADIUS_DEG = 9` of that ring.

C wins on measurement, not taste: on the live pool `corr(lat, altitude) = 0.06`,
so X carries information Y does not — the only justification for having a
second axis at all. It is also exact rather than fitted: one
`SunCalc.getPosition` call, no regression, no dateline handling, no
pool-relative normalization, no dependence on pool membership.

Semantically X becomes *how far into the sunset this camera is*, measured as
offset from the terminator rather than east–west along a parallel. Given the
pool is defined by a moment rather than a place, that is the truer subject.

Both survive as a `horizontalAnchor` enum (`solarAltitude` default | `order`),
composing with the spec's `strategy` enum (`anchorRelax` | `latitudeBands`) so
the glass settles it. `rowAlign` applies to `order` only.

**Contract change required.** Solar altitude needs the moment the composition
represents, and no existing field supplies it: `lastUpdatedOn` is
`last_fetched_at` (Windy metadata fetch) in the live payload but
`snapshot_captured_at` in reconstructed scenes — two different meanings. So
`MosaicProps` gains an optional `at?: string | number`, defaulting to render
time; `/studio` passes the selected scene's `representsAt`. Additive and
ignored by v1.

### 6b. What `geographicFidelity` interpolates

Two y values per row,
blended:

- `yAnchor` = the row's mean latitude mapped through the lat window onto panel
  height.
- `yPacked` = rows stacked contiguously, the whole block centered vertically.
- `y = lerp(yPacked, yAnchor, fidelity)`

Then one relax pass, top→bottom: if a row overlaps the one above, push it down
by the deficit. Order is preserved and y only ever increases; leftover slack is
pulled back up in a second pass, and anything still overflowing goes to the
uniform scale-down in #7.

The behavior this produces is the reason for the design. On the sparse solstice
scene (9 sunset cams) at fidelity 1, the rows are far apart and float at their
true latitudes — few real sunsets, sitting where they are on Earth. On the
equinox flood (95 cams) the anchors all collide, relax pushes them into a
near-contiguous column, and it reads as a dense geographic stack. Same code,
both scenes correct, and the dial between them is genuinely meaningful rather
than cosmetic.

Two smaller choices inside it:

- **Row height** = tallest member; shorter tiles centered within the row.
- **Horizontal alignment** — centering rows with a fixed gap keeps sparse rows
  floating (honest); justifying them edge-to-edge makes every row touch both
  margins and reads as a grid, which lies about longitude. This becomes a
  `rowAlign` knob (`center` | `justify` | `west`, default `center`) and the
  glass settles it — exactly the kind of call the dials exist for.

## 7. Overflow never culls arbitrarily

v1's overflow culler dropping half the pool is the named reference failure. If
the composition still overruns the panel after the visibility policy and
`maxTiles`, v2 applies **one uniform scale-down to the whole composition**, so
relative hierarchy and geography survive intact. Only if that hits a hard scale
floor does it drop tiles — lowest-scoring gate-failers first, deterministically,
reported in `layout.dropped`.

## 8. Knobs the parent spec's list omits, and one it should drop

Three numbers would otherwise be hardcoded composition constants, which the
done-signal forbids, so they become dials: `tileGapPx`, `latNorth` (70),
`latSouth` (−60).

v1's `upscaleMax` is **deleted** rather than carried over: it silently pushes
tiles below the floor, which contradicts the parent spec's fixed directive that
gate-failers pin to the *exact* floor.

---

## Out of scope for phase 2

- All motion, continuity, and hysteresis (parent spec phase 3).
- The reconstructed-scene timestamp skew (see the measured-facts section) —
  a real bug, but a data/reconstruction bug, not a composition one.
- Camera-level reputation / consistent-false-positive exclusion (see #3).
- Choosing between ML model versions on the glass (see #1).
- `StudioClient`'s status strip still imports v1's `passesGate`, so its
  gate-pass counts describe v1's interpretation while previewing v2. Left
  alone deliberately — it is a shared-helper touch on the other session's
  lane. Noted for a follow-up with a heads-up message.
