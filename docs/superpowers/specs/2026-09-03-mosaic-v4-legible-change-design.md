# Mosaic v4 — legible change

**Status:** approved in conversation 2026-09-03, building on branch
`feat/mosaic-v4`. Parent: the v3 band paradigm
(`2026-09-02-mosaic-v3-band-paradigm-design.md`). v4 keeps v3's composition
and changes only how change *looks*: when tiles arrive, leave, shrink and
refresh, and whether any of it betrays the minute-long poll underneath.

## 1. What this is

Three complaints from watching the wall, in Jesse's words:

1. "It would be nice if they were slowly staggered so it wasn't as clear that
   it's on a cron."
2. "It would be nice if the pictures didn't overlap at all. Fade to black or
   near black when something fades out before the next thing that's
   overlapping it fades in."
3. "Some feeds are being lost. Ideally we should see them fade and get smaller
   after a sunset, but this isn't happening."

v4 is a fork of the v3 folder with four additions: an **exit taper** in the
engine, **sequenced transitions** and **scattered change** in the motion
layer, and a **miss grace** in the tile loader. v3 is frozen from this point
as the show fallback (opening night is Fri 2026-09-12); nothing lands in v3
except an emergency, so nothing has to land twice. The loser is deleted after
the show, per the versioning workflow.

### A finding that precedes all of this

At the time of the conversation the live glass was on **v2**
(`activeVersion: v2`, ceiling 700, max 30 tiles). v2's row-relax and
de-overlap passes slide tiles through each other under drift, which is most
of complaint 2. v3 removed those passes and never admits two overlapping
tiles. **Step zero is a studio operation, not code: flip `activeVersion` to v3
and Deploy.** v4 is designed against v3's remaining transitional overlap, not
against v2.

## 2. Why each complaint happens (measured in the code, 2026-09-03)

**The cron tell.** `useLoadTerminatorWebcams` refetches the pool every 60 s
(SWR `refreshInterval`). `useLoadedTiles` creates a new `Image` per camera
per refetch, so `MosaicCanvas` sees `fade.current !== entry.img` for *every*
tile every cycle and starts every crossfade in the same instant; identical
images crossfade invisibly, changed ones all at once. Geometry retargets
start in the same instant. The v3 stagger dials default to zero, and in
`drift` mode, the shipped default, `sample()` never reads `track.startAt`,
so stagger is silently inert in the one mode Jesse likes.

**The overlap.** v3's `admit()` guarantees non-overlapping targets. What
remains is transitional: `commit()` marks a departing track `exiting` and an
arriving track new *at the same moment*, both animate over `motionDurationMs`
in the same pixels, and the canvas draws both. That is a dissolve between two
different cameras. Exits shrink only `ENTRY_INSET` = 6 %, so a departure
reads as a ghost rather than a shrink.

**The lost sunsets.** A tile leaves when its camera leaves the pool: the cron
sweep stops seeing a camera once its sun drops below the coverage window,
`TERMINATOR_RETENTION_GRACE_MS` (20 min) runs out, and the next refetch drops
it. Tile height is a function of score, and the score is re-rated only by
the 15-minute cron while the camera is still inside the sweep. The last
rating before departure is a sunset rating, and `altitudeToUnit` clamps at
the window edge, so the tile sits at the panel edge at full size for up to
20 minutes and then fades to nothing. A single failed image load and, in v3,
eviction by a stronger neighbour produce the identical picture.

## 3. Decisions settled in conversation — do not re-derive

- **v4 is a fork, not v3 dials.** The 8×240 decision was two numbers and was
  rightly kept in v3. This is a new motion model plus an engine change, and
  the runbook wants v3 untouched on the glass through the show.
- **Places still hold still.** PR #116's conclusion stands: motion lives in
  the refresh and the size, never in the position. Nothing here moves a tile
  for effect.
- **Fade-through, not dissolve, is the default.** Film calls the requested
  transition fade-out then fade-in; Material Design's "fade through" is the
  same pattern for unrelated content. Dissolve stays as a dial value for the
  A/B.
- **The taper uses data the client already has.** Solar altitude is computed
  per tile at every refetch. No cron, rating cadence, or schema change.
- **Defaults are starting guesses, not measurements.** Every number below is
  a dial; the glass decides.

## 4. v4 as a registry version

`app/components/mosaic/v4/` is `cp -R` of v3 with identifiers renamed
(`MosaicV4`, `V4_SETTINGS_SCHEMA`, `V4Config`, `v4Config`, test ids
`v4-…`). Registered in `registry.ts`; `DEFAULT_MOSAIC_VERSION` stays `v1`.
The studio's `activeVersion` dial and `?v=v4` pick it up from the registry
with no further wiring (`SHARED_SCHEMA` derives its options from
`MOSAIC_VERSIONS`). Its settings namespace is `v4`; the scenes restore-dials
path reports dropped keys through the existing `droppedKeys()`.

## 5. Exit taper (engine)

### 5.1 The exit edge

Each feed has one edge where cameras leave the window. On the **sunset**
panel the sun is setting, altitude falls, and cameras leave at
`axisNightEdgeDeg`. On the **sunrise** panel altitude rises and cameras leave
at `axisDayEdgeDeg`. `exitEdgeDeg(cfg, feed)` returns the one that applies.

### 5.2 The taper

New dial `exitTaperDeg` (number, 0–15, step 0.5, default **6**). For a
gate-passer with a known altitude, let `d` be the tile's angular distance
inside the window from the exit edge, clamped to `[0, exitTaperDeg]`, and
`t = smoothstep(d / exitTaperDeg)`. The tile's height becomes

    floorPx + (scoreHeight − floorPx) × t

so a tile at or past the exit edge renders at exactly the floor and a tile
`exitTaperDeg` or more inside renders at its score height. `0` disables the
taper. Gate-failers already pin to the floor and are untouched. A null
altitude is untouched (the moment is unknown; centre placement is already
the honest answer, and shrinking it would be a claim).

`sizeTiles` gains a `feed` parameter; every caller in `compose.ts` already
has it. The peer feed is sized as the peer feed, as it is placed as the peer
feed.

### 5.3 What this buys

A sunset gets smaller as it ends, arrives at the edge at floor size, sits
there small and dark through the retention grace, and leaves from the floor.
Its departure reads as the end of a sunset. Width follows height through the
source aspect, so the tapered tile also collides less and evicts less near
the edge.

## 6. Sequenced transitions (motion layer)

### 6.1 Vocabulary

`motion.ts` keeps its shape: a track per tile with `from`, `to`, `current`,
`startAt`. Three things are added to a track: a `phase` (`enter`, `travel` or
`exit`), an optional `pending` retarget (§7), and the tile's `lat`, so a
departing track can still be keyed by latitude after it has left the layout.
An exit keeps no end of its own — it is derived as `startAt + fadeMs`.

### 6.2 Dials

| key | kind | default | replaces |
|---|---|---|---|
| `transitionStyle` | `fadeThrough` \| `dissolve` | `fadeThrough` | — |
| `fadeMs` | number 0–60 000 | 20 000 | v3 used `motionDurationMs` for enter/exit |
| `fadeScale` | number 0.3–1 | 0.85 | `ENTRY_INSET` constant (0.94) |

`motionDurationMs` now means travel only: how a tile that stays moves or
resizes. `crossfadeMs` is unchanged and still means a new frame fading up
inside one tile.

### 6.3 Exit

A track that is in the state and absent from the new targets starts exiting
at `now + delay(id)` (§7) and ends at `startAt + fadeMs`. Its exit pose is
its current pose scaled about its own centre by `fadeScale`, opacity 0. Exit
always runs as a tween over `fadeMs` in `tween` and `drift` modes; that is
what v3 does today and it is right, drift has no target to chase. `cut`
snaps, because a cut that fades is not a cut.

### 6.4 Entry, and the rule that forbids overlap

A new target enters from its arrival pose scaled about its centre by
`fadeScale`, opacity 0, over `fadeMs`. Its start is

    max(now + delay(id), latest endAt of every exiting track whose current
        rect intersects the entry's target rect)

under `fadeThrough`, and just `now + delay(id)` under `dissolve`. An entry
that intersects nothing departing does not wait. A tile that stays is never
consulted: `admit()` guarantees its target does not overlap the entry's
target, and under a pinned axis its current pose is within hundredths of a
pixel of that.

This is the guarantee complaint 2 asks for: **under `fadeThrough`, two
cameras' pixels are never drawn over each other.** A rect test with the
configured `tileGapPx` is enough; the canvas backdrop is black, so opacity 0
*is* fade to black.

### 6.5 Re-entry

A target that reappears for a track still exiting cancels the exit and
tweens from the current pose back to full, as v3 does. The miss grace (§8)
makes this rare.

## 7. Scattered change (motion layer and canvas)

### 7.1 The key

`staggerKeys` keeps `latitude`, `sweep` and `magnitude` and gains
**`scatter`**, the new default for `motionOrder`: a stable key in `[0, 1)`
from a hash of the webcam id. Stable across refetches, reloads and both
panels, so a camera always changes at the same point in the minute. `none`
remains and means every key is 0.

### 7.2 The spread

`motionStaggerMs` is renamed **`changeSpreadMs`** (number 0–120 000, step
1 000, default **60 000**, the poll interval). `delay(id) = key × spread`.
With the spread equal to the poll, change arrives as a steady trickle and
the tick has no signature. `waveGridMs` is unchanged and still only rounds
the `sweep` origin.

### 7.3 What the delay applies to

1. **Exits and entries** (§6): their `startAt`.
2. **Retargets of a staying tile.** `commit()` stores the new pose as
   `pending` with its own `startAt`; `sample()` promotes it to `from`/`to`
   when the time comes. Drift then chases from that moment. This is the
   change that makes stagger real in drift mode. A second retarget before
   the first promotes simply replaces `pending`.
3. **Frame crossfades.** `MosaicCanvas` no longer starts a crossfade the
   moment `byId` changes. A changed image becomes `pending` for that tile
   with `startedAt = now + delay(id)`; the old frame keeps drawing until
   then, and a newer image arriving first replaces the pending one (the
   skipped frame was at most a minute old). `commit()` returns the delay
   map so the canvas and the motion layer schedule from one clock.

The map covers **departing** ids as well as arriving ones, and each entry is
the delay to the start the motion layer actually settled on — recorded
*after* the fade-through wait of §6.4, not the raw `key × spread`. So a tile
held behind a departure holds its frame crossfade for exactly as long as it
holds its pixels.

### 7.4 Cost, stated honestly

Spreading change across the whole minute means the render loop parks less.
Today it parks after every tile has settled, roughly 30 s into each minute
under drift; under v4 there is usually something mid-fade. Drawing ~30
scaled images per frame on a Pi 4 is the exposure, and it is unmeasured.
`changeSpreadMs = 0` restores today's timing exactly, so the cost is
dialable off. Measuring it on the glass is part of verification (§10), not
of this design.

## 8. Miss grace (tile loader)

New dial `missGraceCycles` (number 0–5, step 1, default **2**). In
`useLoadedTiles`, a camera present in the previous result and absent from
this one, whether missing from the pool list or failed to load, is carried
forward with its previous image, its previous signal and a *fresh* solar
altitude (recomputed from its stored coordinates, so the taper keeps
advancing), for up to `missGraceCycles` consecutive cycles. A reappearance
resets the count. `0` disables the hold. The setup overlay's counts include
held tiles under their own label so a held camera is not mistaken for a live
one.

## 9. The dial set, complete

Unchanged from v3: everything in the signal, visibility, sizing, arrangement,
eviction and overlays sections; `motionMode` (default `drift`),
`motionDurationMs`, `crossfadeMs`, `waveGridMs`.

New or changed:

| section | key | default | note |
|---|---|---|---|
| sizing | `exitTaperDeg` | 6 | §5 |
| motion | `motionOrder` | `scatter` | new option, new default (§7.1) |
| motion | `changeSpreadMs` | 60 000 | was `motionStaggerMs` (§7.2) |
| motion | `transitionStyle` | `fadeThrough` | §6 |
| motion | `fadeMs` | 20 000 | §6.2 |
| motion | `fadeScale` | 0.85 | §6.2 |
| visibility | `missGraceCycles` | 2 | §8 |

Every one is reachable from the URL through the existing `urlOverrides`, so
`?v=v4&transitionStyle=dissolve` beside `?v=v4` is the A/B.

## 10. Testing

Engine (`engine/sizing.test.ts`, new cases): sunset tile at the night edge
renders at the floor; `exitTaperDeg` inside renders at score height; halfway
renders between; sunrise mirrors at the day edge; `0` disables; gate-failers
and null-altitude tiles are unaffected; the peer feed tapers at the peer's
edge. `realPool.test.ts` re-pinned with the taper on and the reason recorded
beside the numbers.

Motion (`motion.test.ts`): `scatter` keys are deterministic, in `[0,1)`, and
differ across ids; `delay = key × spread`; a retarget in drift mode does not
move before its `startAt`; an exit ends at `startAt + fadeMs` at `fadeScale`
and opacity 0; under `fadeThrough` an entry intersecting an exiting rect
starts at that exit's `endAt` and a non-intersecting entry starts at its own
delay; under `dissolve` both start at their own delay; **property: under
`fadeThrough`, sampling every frame of a replacement never yields two frames
whose rects intersect with both opacities above zero.**

Canvas (`MosaicCanvas.test.tsx`): a changed image does not begin fading
before its delay; a second change before the first begins replaces it.

Loader (`useLoadedTiles.test.ts`): a camera missing for one cycle is held
with a fresh altitude; missing for `missGraceCycles + 1` is dropped;
reappearance resets; `0` drops immediately.

Registry: v4 resolves, its schema is registered, `activeVersion` lists it.

On the glass, before the Wed 2026-09-10 freeze: `?v=v4` on one panel for at
least two evenings, judged against v3 on the other; and the render loop's
duty cycle on the Pi measured with `changeSpreadMs` at 60 000 and at 0.

## 11. Out of scope

- Skipping crossfades between byte-identical frames (the canvas is tainted
  by production frames; identical crossfades are invisible anyway).
- Any change to rating cadence, pool retention, or the sweep window.
- Any change to v1, v2 or v3.
- Kiosk frame-rate capping. Measure first (§7.4).
