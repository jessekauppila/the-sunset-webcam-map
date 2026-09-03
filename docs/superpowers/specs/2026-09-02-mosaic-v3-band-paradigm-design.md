# Mosaic v3 — the band paradigm

**Date:** 2026-09-02
**Status:** Design approved in conversation. Ready for implementation planning.
**Parent specs (binding):** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md`,
`2026-09-01-mosaic-v2-phase2-composition-decisions.md`
**Sibling spec:** `2026-09-02-terminator-pool-coverage-design.md` (Plan B). The two
meet at one boundary, defined in §8.

---

## 1. What this is

v2 arranges tiles by floating rows whose vertical position is the average
latitude of whoever happens to share the row. v3 replaces that with **fixed
bands**: the screen is an abstract map, the vertical axis is quantised into
strips that never move, and the horizontal axis is perpendicular distance from
the terminator. Nothing on the wall changes position because of who else is in
the pool.

v3 ships as a new registry entry alongside v1 and v2. `DEFAULT_MOSAIC_VERSION`
stays `v1`. All three remain switchable by `?v=` so they can be compared on the
same glass.

### What v3 cannot do, stated up front

The small-to-large-to-small arc — a camera growing as it approaches the
terminator and shrinking after — **is not achievable by this spec alone**, and
implementers should not chase it. See §2. v3 delivers a stable, legible,
absolutely-positioned wall. The arc needs Plan B.

---

## 2. The measurement that drives this design

Run 2026-09-02 against 46,079 scored snapshots joined to camera coordinates,
solar altitude computed per frame with SunCalc at capture time.

Share of frames Claude scored at or above 0.5, by the sun's altitude:

| sun altitude | frames | good |
|---|---|---|
| −16° to −14° | 2,577 | 1.0% |
| −12° to −10° | 3,040 | 3.3% |
| −8° to −6° | 5,862 | 10.8% |
| −2° to 0° | 1,959 | 14.9% |
| **0° to +2°** | 1,701 | **19.7%** |
| **+4° to +6°** | 2,167 | **19.4%** |

Good sunsets happen with the sun just above the horizon. The 4,525 good frames
come from 679 distinct cameras, the most prolific contributing 3.8% and the top
ten 22.6%, so this is a property of nature rather than of a few sites.

Reproduce with `node scripts/altitude-quality-report.mjs`.

**Consequence.** The pool gathers within `SEARCH_RADIUS_DEG` (11°) of
`TERMINATOR_SUN_ALTITUDE_DEG` (−13°), so it holds cameras from −24° to −2° and
nothing else. On the sunset panel a camera appears at the day edge already past
its quality peak, and can only shrink. `masterConfig.ts` already records the
same fact in a comment: the day-side escalation ring reaches golden hour,
"which the base ring at −13 misses entirely."

### Timestamps are correct — do not "fix" them

`webcam_snapshots.captured_at` is declared `timestamp without time zone`, which
looks like a bug and is not one. Every hourly offset from −8 to +8 was tested
against 21,061 Claude-confirmed sunsets, scored by how many land within 8° of
the horizon:

| offset applied | sunsets near the horizon |
|---|---|
| −1 h | 56.8% |
| **0** | **74.4%** |
| +1 h | 43.8% |

A sharp peak at zero. Stored local time or mishandled DST could not produce
that. Nothing in the pipeline applies a zone offset and `webcams.timezone` is
null for all 21,061 rows, so there is nothing to get wrong. Migrating the
column to `timestamptz` would turn a working convention into an enforced
guarantee, but the data is correct today and the migration is **explicitly out
of scope**, recorded here so the question is not re-opened.

---

## 3. Decisions settled in conversation — do not re-derive

- **West stays on the left.** Tiles travel **left to right** on both panels.
  The terminator sweeps westward, so relative to a terminator-centred frame the
  ground moves east, and east is on the right. Right-to-left motion and
  west-on-the-left cannot both hold; west-on-the-left won.
- **On the sunset panel** the left edge is the day side and the right edge is
  deep twilight. **On the sunrise panel** those are reversed, because the day
  side of the sunrise line is to the east. Both still travel left to right.
- **Size means quality and nothing else.** No positional term. The
  small-large-small sequence is meant to emerge from the detector firing during
  the sunset window, not from geometry.
- **X is perpendicular angular distance from the terminator.** This is exactly
  solar altitude, not an approximation: a point with the sun h degrees up sits
  h degrees on the day side of the terminator circle. v2's axis is already
  correct on this point and carries over unchanged.
- **Screen centre is the pool's ring at −13°**, not the geometric terminator at
  0°. Zero is outside the window today and clamps.

---

## 4. v3 as a registry version

`app/components/mosaic/registry.ts` ships every version side by side and
resolves one from `?v=`. v3 is added the way the registry's own comment
prescribes:

- new folder `app/components/mosaic/v3/`, seeded as a copy of v2
- `MOSAIC_VERSIONS.v3` and `MOSAIC_SETTINGS_SCHEMAS.v3` rows
- `DEFAULT_MOSAIC_VERSION` unchanged at `v1`

Settings live in v3's own namespace, so v2's dials are untouched and a v2 scene
still replays as v2. The duplicated engine folder is the intended cost; the
registry comment prescribes deleting a loser's folder rather than abstracting
across versions.

**Do not refactor v2's engine into a shared module.** Versions are independent
by design so they can evolve or be deleted without touching each other.

---

## 5. The band model

### 5.1 Bands fix the vertical axis

The latitude range (`latNorth` 70, `latSouth` −60) is cut into `bandCount`
equal strips. A camera's band follows from its latitude alone. The strip
covering 45°N to 50°N is the same pixels tonight and next year, holding one
camera or forty.

This is the vertical cure for the disease that was fixed on the horizontal axis
on 2026-09-01. v2 forms rows by greedy width packing over the current pool and
places each row at its members' mean latitude, so adding one camera changes row
membership, which changes the means, which moves every row.

Bands are always drawn at their own position. An empty band stays empty; a
quiet latitude reads as quiet.

### 5.2 Placement is absolute, and nothing is ever shoved

Each tile is placed at:

- **x** from its solar altitude through the axis window (§6), unchanged from v2
- **y** centred on its band
- **height** from quality, width from source aspect, unchanged from v2

There is no de-overlap pass. v2's `packByAltitude` pushes colliding tiles
rightward and then slides the whole row back, which means one arriving camera
can move every tile in the row and corrupts the axis. **That pass is deleted in
v3, not adjusted.**

### 5.3 Collisions are resolved by eviction, not by movement

One rule covers both axes. Within a band:

1. Compute every candidate's rectangle at its absolute position.
2. Sort candidates by **effective quality** descending (§5.4).
3. Admit in order. Skip any candidate whose rectangle, expanded by
   `tileGapPx`, intersects a rectangle already admitted.
4. Skipped candidates are not drawn.

Deterministic, absolute position preserved exactly, and the best sunset always
wins its neighbourhood. A large tile evicts more neighbours, which is correct:
it earned the space.

Test the rectangle intersection in **2D**, not horizontally only. A tall tile
may exceed its band's height, and testing both axes lets bands stay fixed
without capping tile size. Candidates are drawn from the whole panel's admitted
set, not the band's, so a tall tile cannot overlap a neighbouring band's tile.

### 5.4 Hysteresis, so near-ties do not trade places

Two cameras with close scores must not swap every poll. Two mechanisms, both
required:

- **Incumbency bonus.** A tile currently on screen competes with
  `quality + hysteresisMargin`. A challenger must beat it by that margin.
- **Minimum dwell.** A tile that has been on screen for less than
  `minDwellMs` is not evicted at all.

Both become dials. Defaults are a starting guess, not a measurement:
`hysteresisMargin` 0.05, `minDwellMs` 90,000.

This requires state across compositions, which `compose()` has never had — it
is pure, and must stay pure. Pass the previous admitted set and a clock reading
in as arguments; do not reach for module state or a hook inside the engine.

The parent spec listed hysteresis as out of scope for phase 2. This spec brings
it into scope for v3.

### 5.5 Entering and leaving are crossfades

Admission and eviction are visible events. Reuse v2's `crossfadeMs` so tiles
fade rather than pop. The motion layer added in PR #116 already parks its
render loop when settled and that behaviour carries over.

### 5.6 How band eviction composes with global overflow

They are separate stages and must stay separate. Band eviction runs first and
handles crowding within a band. The existing global overflow stage then handles
total vertical extent, still applying one uniform scale-down before dropping
anything, per the parent spec's named reference failure.

`layout.dropped` continues to report **overflow casualties only**. Band
evictions are a third category and get their own field so the setup overlay can
tell the operator which mechanism removed a camera.

---

## 6. The axis window becomes its own dials

Today the screen's edges are derived from the cron's constants:

```js
export const ALTITUDE_WINDOW = {
  min: TERMINATOR_SUN_ALTITUDE_DEG - SEARCH_RADIUS_DEG,
  max: TERMINATOR_SUN_ALTITUDE_DEG + SEARCH_RADIUS_DEG,
};
```

v3 gives the display two dials, `axisNightEdgeDeg` and `axisDayEdgeDeg`,
defaulting to the current derived values of −24 and −2.

**The window can only usefully narrow.** A window wider than the pool leaves
dead space at the edges; a window narrower than the pool clamps the excluded
cameras into a pile. Narrowing is still worth having, because good frames
currently crowd into the day-side third of the panel and a tighter window
spreads them across it.

Decision 6a chose the derived form so the axis would track when the constants
moved. That property is replaced by a **test** asserting the configured window
covers the range the sweep actually gathers, rather than by derivation. The
test must read Plan B's coverage constant, not `SEARCH_RADIUS_DEG` directly.

---

## 7. The centre line overlay

The terminator zone is the organising idea of the whole composition and is
currently invisible. v3 draws it, under two constraints:

- **Toggleable** from `/studio`, as a dial in the overlays section alongside
  `showTileRatings` and `showModelReadout`.
- **Never on the Pi.** A dial alone is insufficient: Deploy copies settings
  rows to the kiosk, so a dial left on in studio would follow it to the wall.

Follow the `setupMode` precedent. The kiosk routes read `?setup=1` from the URL
and the Pi's launch script never passes it. The centre line is suppressed
structurally in `app/kiosk/*/page.tsx` unless an explicit URL parameter is
present, so no settings row can put it on the glass, and it stays available by
hand for debugging on the device.

---

## 8. The boundary with Plan B

Plan B changes which solar altitudes the pool contains. The two specs meet at
exactly one contract:

- **Plan B owns** the altitude range the sweep gathers, and must export it as a
  named constant describing the union of every ring swept.
- **Plan A owns** the display window, and must never assume it equals
  `TERMINATOR_SUN_ALTITUDE_DEG ± SEARCH_RADIUS_DEG`.
- The test in §6 is the enforcement point.

Neither plan blocks the other. v3 can be built and judged against today's pool;
it simply will not show the growth half of the arc until B lands.

---

## 9. Testing

The parent spec's bar applies. Specific to v3:

- Band assignment is a pure function of latitude and does not consult the pool.
- Adding or removing a camera moves **no** other tile. This is the headline
  property and deserves a direct test on a real scene pool.
- Eviction is deterministic and order-independent given the same inputs.
- Hysteresis: a challenger within the margin does not displace an incumbent; a
  challenger beyond it does, but not before `minDwellMs`.
- 2D intersection, including a tile taller than its band.
- The centre line does not render on a kiosk route without the URL parameter,
  even when its setting is on.
- The axis window test from §6.

Use the live capture scene (21 sunrise / 42 sunset) as the trustworthy pool.
Both reconstructed historical scenes sit roughly 7 hours off in local solar
time and cannot judge anything twilight-dependent — a known, separate,
unfixed bug recorded in the phase-2 decisions doc.

---

## 10. Out of scope

- Moving `TERMINATOR_SUN_ALTITUDE_DEG` or widening the sweep — Plan B.
- The `captured_at` type migration (§2).
- Promoting v3 to `DEFAULT_MOSAIC_VERSION`. That is a decision for the glass
  after comparing all three.
- Refactoring shared code out of v1/v2/v3.
- The reconstructed-scene timestamp skew.
- The ripple / refresh-head paradigm from the 2026-09-02 motion handoff. It
  remains designed-but-unbuilt and is not superseded by this spec.
