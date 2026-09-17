# solo2 rendezvous phase 3: the scheduler

Issue #228. Phase 1 and 2 of the rendezvous shipped in #216/#224/#225/#237
(`docs/superpowers/specs/2026-09-14-solo2-beat-and-rendezvous-design.md`).
This spec replaces §3.9 of that document — the "search later" seam — with what
the measurement says the seam actually needs.

## 1. What the measurement changed

Six hours of 2026-09-16 (00:00–06:00Z), both feeds, one pool, replayed through
`scripts/solo-replay.ts --feed both`. Only the participation gate moved:

| `rendezvousRank` | `valleys` | meetings | one every | conversion | dropped | grown | too soon |
|---|---|---|---|---|---|---|---|
| 0.6 (today) | 1 | 18 | 20 min | 8% | 64 | 6 | 0 |
| 0.2 | 1 | 84 | 4.3 min | 25% | 400 | 18 | 0 |
| 0 | 1 | 133 | 2.7 min | 30% | 661 | 34 | 0 |
| 0 | 0 | 423 | 51 s | 60% | 2203 | 48 | 0 |

(Conversion is meetings over announced landings — `made / (made + missed)`.
Draws in the window: 726 sunrise, 627 sunset; median dwell 28 s and 32 s, so a
run is about half a minute and "every 2nd or 3rd timelapse" is 60–90 s.)

Three facts follow, and they set the whole design:

**Cadence needed no scheduler.** Opening the gate alone takes 18 meetings to
133. The issue's premise — that a receding-horizon search is needed to make
meetings happen at all — is wrong. Meetings are abundant.

**Timing was never the problem.** `too soon` is 0 at every setting. The fit has
not once failed because the arithmetic didn't reach. There is nothing for a
joint search over two clocks to optimise.

**The failure is a picking failure.** 271 of 311 misses are `no partner`: a
landing was announced and reachable, and the camera the rotation handed the
other screen could not meet it — no peak, or too short a climb. Very often
another camera a place or two back in the same queue could have. The `valleys 0`
row is the proof: with every draw eligible, conversion goes 30% → 60% on the
same pool, because there were always more candidates than the rules would look at.

So phase 3 is not a search over *when* the screens draw. It is a **choice over
which camera each screen draws**, made where the information already is.

## 2. Vocabulary

Carried from the rendezvous spec §3.1, plus:

- **Landing** — the tick a run's peak goes on glass; published as
  `kiosk_screen_state.peak_at`.
- **Announcing** — a screen drawing an eligible run with nothing to meet, so it
  publishes a landing (the rendezvous spec's `pin`).
- **Meeting** — both screens landing on the same tick (`fit`).
- **The window** — the first `rendezvousWindow` cameras of a screen's queue, in
  the order the rules already put them. The rendezvous may choose from these
  and only these.
- **Conversion** — meetings over landings announced. The scheduler's objective.
- **Pair rank** — the lower of the two cameras' `qualityRank` at the meeting.
  How good a meeting was.

## 3. The picker

On an advance for feed `F` at tick `t0`, with a peak-role draw:

**Tier 1 — a landing is outstanding and reachable.** `G.peak_at` is a tick `T`
ahead of `t0`. Take the window — the first `rendezvousWindow` cameras of `F`'s
queue. For each, ask the existing question: can its peak land on `T` by thinning
its climb (rendezvous spec §3.5)? Among those that can, draw the one with the
highest `qualityRank`; ties break by fewest frames dropped, then by the earlier
position in the queue. Plan its run as §3.6 with `before` set from the beats
available, exactly as today. `F.peak_at = T`, `rendezvous = true`.

Growing is asked only when no camera in the window can fit by thinning alone.
Growing does not draw — it extends the run already ending, and the choice is
remade at the later tick against a queue that has not moved — so it is the
fallback, not a candidate's property. Take the window's best-ranked camera whose
climb is shortest of those needing growth, and grow by what that camera needs; if
the ending camera has no frames left, tier 2.

**Tier 2 — no landing outstanding, or none of the window can reach it.** Draw
the queue's head, as the rules have always chosen it, and announce: plan with
the full climb, `F.peak_at = t0 + (changeBeats + before) · beatS`. This is the
rendezvous spec §3.4 step 4 unchanged, and it is also the honest answer to a
window that came up empty — nothing is forced, the landing passes, and the next
draw gets another chance.

**Tier 3 — not eligible.** A valley draw, a camera with no peak, or the dial
off: the queue's head, a plain run, `peak_at = null`. Unchanged.

Rank no longer appears in any of these tiers as a gate. A draw is eligible when
the dial is on, the role is `peak`, the camera has a peak, and the camera run is
on — nothing else. That single deletion is the cadence fix of §1.

### 3.1 Why the window, and why this deep

Cameras with long climbs are the easiest to land on an arbitrary tick, so a
free choice would hand the same few cameras every meeting. The queue is already
ordered by "never shown, then longest since shown" (solo's rule 3), so taking
the choice from the front of that order bounds the damage in both directions: a
camera that just played is at the back and cannot return quickly however
convenient it is, and no camera can be starved, because the queue keeps
advancing whether the rendezvous picks from it or not.

`rendezvousWindow = 1` is exactly today's behaviour — the rendezvous never
chooses — so the dial spans from the current engine to a free choice, and the
replay can price every setting on the same pool.

### 3.2 Magnitude is spent inside the window

Within the window, every camera that can reach `T` is an acceptable meeting, so
preferring the best-ranked among them costs no cadence at all. This is what the
two-dial decision (issue #228, 2026-09-16) asked for: cadence comes from
un-gating and from conversion, magnitude comes from this preference, and neither
is buying itself with the other's currency.

Nothing marks a good meeting on glass. A good meeting is two stunning frames
landing together; the viewer sees only the sunsets and two screens that
sometimes agree. Magnitude is measured, not decorated.

## 4. What this does not change

Named so a later phase does not quietly assume otherwise:

- **Valleys stay out.** A valley draw is never eligible. Letting valleys
  participate is the `valleys 0` row — 423 meetings and 2203 frames dropped —
  and it dissolves the rhythm the beat spec ships. Peak-role draws alone reach
  the target.
- **The announcing screen keeps aiming with its own frames only.** It does not
  project the other screen's queue and does not choose its camera to suit it.
  `too soon` is 0, so its timing is not the bottleneck, and leaving it alone
  means the screens still pass exactly one number and never have to agree about
  anything.
- **One number through the server.** No new column, no negotiation. The screens
  read each other's row as they already do.
- **The fit arithmetic.** Thinning, growing, and the window around the peak
  (rendezvous spec §3.5, §3.6) are untouched. Only *which camera* is asked to
  fit changes.

## 5. Dials

The `rendezvous` section of the `solo2` namespace becomes:

| key | kind | default | meaning |
|---|---|---|---|
| `rendezvous` | boolean | off | the mechanism on or off (unchanged) |
| `rendezvousWindow` | 1–8, step 1 | 4 | how many cameras deep into the queue the rendezvous may choose. 1 = never chooses |
| `rendezvousGood` | 0–1, step 0.05 | 0.75 | a meeting counts as *good* at or above this pair rank. A label for the studio and the replay — it gates nothing |
| `rendezvousRest` | 0–8 runs, step 1 | 0 | after a meeting, how many of this screen's runs pass before it will announce again. A ceiling on cadence; 0 is off |

**`rendezvousRank` is removed.** Repurposing the key would leave a slider whose
meaning silently inverted — it used to decide whether a meeting could happen at
all, and nothing in the new engine gates on rank. The settings schema sanitizes
unknown keys, so a stored value falls away on the next deploy.

`rendezvousRest` is specified but expected to be inert at the current rate: at
one meeting per 4.7 runs a rest of 3 never binds. It exists because conversion
is the thing this spec raises, and a ceiling should be in place before the floor
moves. It is the "make it a dial, pick later" answer from #228.

Counting it needs no schema: `kiosk_draws.rendezvous` already records every
meeting, so "runs since the last meeting" is a query against the draw log.

## 6. The studio readout

One picture, replacing the tape's rendezvous marks and extending the queue
column. Five lanes, top to bottom: sunrise's queue, sunrise on glass, the clock,
sunset on glass, sunset's queue.

**A queue lane is the queue in its own order** — 1st, 2nd, 3rd — not in time
order. Each camera is one box holding its frame sequence in capture order inside
a single bin-coloured border, with the frames that will not play drawn dim: the
convention `FeedColumn` already uses, so the run a draw would play, and what a
bigger cap would add, read the same way they do today.

**A line runs from each camera in the queue to where it reached the glass.**
Taken in turn, the lines stay parallel. **A crossing line is the rendezvous
pulling a camera out of turn** — the whole mechanism in one mark, and the
warning sign too: crossings piling onto the same camera mean the window is too
deep and the rotation is being bent too far.

**A meeting is a box around both landing frames**, drawn from the sunrise strip
through the clock to the sunset strip, carrying the tick and the pair rank. A
landing nobody met draws the same box dashed and grey, directly above the queue
that failed to produce a partner — so a miss is as legible as a hit and points
at its own cause.

**Every frame stays clickable.** The lanes call the existing
`onSelect(entry, feed, list)`, so a click opens `FrameModal` with the label card
and its rating, arrows stepping through that lane's frames in order. Nothing
about inspecting or rating a frame changes.

### 6.1 The queue is a snapshot

A queue is not constant across a span: every draw sends its camera to the back
and shifts the rest up. A queue lane therefore shows the queue **as it stood for
one draw** — by default the next one, so the live studio reads as "here is what
is coming and which of it can meet the landing," and clicking a past block shows
the queue that block actually chose from. The lines are drawn for that draw
alone.

### 6.2 The rendezvous controls

The removed `rendezvousRank` slider goes; `rendezvousWindow` takes its place as
the control with a tradeoff worth feeling — low means strict rotation and fewer
meetings, high means more meetings and more repetition. `rendezvousGood` and
`rendezvousRest` sit beside it.

The wider question of which studio controls still earn their place now that
dwell, transitions and shape are the ones reached for by hand is a separate
sweep, filed as its own issue.

## 7. Measurement

`replayPair` and `scripts/solo-replay.ts` report against the two dials rather
than a bare count. The rendezvous block becomes:

- **Cadence** — meetings per hour, and the spread of runs between them (median
  and worst gap), per screen.
- **Magnitude** — the distribution of pair rank, and how many meetings cleared
  `rendezvousGood`.
- **Conversion** — meetings over landings announced, with the miss reasons
  as today. This is the number phase 3 exists to move.
- **Tax** — frames dropped and frames grown.
- **Variety** — the existing `draws per camera` table gains a meetings column.
  A camera whose share of meetings runs well above its share of draws is the
  window being too deep, and is the first thing to read after a dial change.

`replayPair` already holds both pools and the pin state, so all of this is
counting, not new machinery.

## 8. Seams and scope

`fitNext(mine, theirs, dials)` stays the one function, and keeps its purity — it
already receives `mine.entries`, the whole pool, so choosing a camera needs no
new input and no second read. Two changes to its contract:

- It receives the queue order it may choose from, rather than a single `pick`.
- Its draw-shaped decisions carry back the camera chosen, since the advance
  commits that pick to the screen row and the pool tallies.

`drawSlot` (`app/lib/solo/advance.ts`) and `replayPair`
(`app/lib/solo/replay.ts`) both call it the same way they do now and take the
pick from the decision instead of from `next2`.

**No migration.** `peak_at` and `rendezvous` already exist on both tables.

**Order of work.** Un-gate first and measure; then the window and measure; then
the readout. Each step is a commit the replay can price against the one before
it on the same six hours, and the un-gating step alone is expected to carry most
of the cadence.

## 9. Open questions

- **Should the announcing screen also choose its camera?** It would raise
  conversion further and would bend the rotation in a second place. Left out of
  this phase deliberately; revisit only if conversion stalls below what the
  `valleys 0` row suggests is reachable.
- **`rendezvousWindow`'s default.** 4 is a guess from the shape of the misses,
  not a measurement. The first replay sweep sets it.
