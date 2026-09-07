# solo2 — the dwell budget: frames share a budget with a floor, and the clock leaves the grid

**Date:** 2026-09-06
**Status:** designed, **not built**. Spec landed ahead of the work on
`feat/solo2-dwell-budget` (PR #154) so other sessions can read it. §7's
caption fixes were delivered separately by PR #153.
**Amends:** `2026-09-05-solo2-camera-run-design.md` §2.2 ("every frame plays;
no cap, no hold floor"), §3.2, §4.1, §4.2;
`2026-09-04-solo-kiosk-design.md` §4 rule 2 (rest) and §6.2 (the schedule).
**Applies to `solo2` only.** `solo` keeps the frame as its draw unit, the
fixed grid, and the rest rule exactly as they are.

## 1. What Jesse saw on the deployed glass, 2026-09-06

| seen | cause |
|---|---|
| place names flicker in and out | the caption is bound to `up`, the run frame, in `Solo2Frame.tsx`. Title and place are identical across a camera's frames, but the time line is not: it renders only when the frame has a timezone or a sun altitude, so a frame missing either drops the line and the block reflows on that step. |
| flicker at the end of a run | the caption is a sibling of the animated stack, so it gets no arrival animation. On a camera change the picture dips through black while the words swap instantly. |
| frames of one camera go by too fast | the dwell is a fixed 20 s that the run **divides**. Four frames means four 5 s steps; eight means eight 2.5 s steps. |
| composition on the glass is not what was set | **not yet confirmed**, but nothing in this design can cause it: every dial that decides the composition is in the `shared` namespace, not `solo2`'s. See below. |

A fourth suspect covers the first three symptoms and should be checked while
fixing them: `run` is recomputed from `glass.entries` on every render, and
the glass refreshes state every 60 s. A refresh landing mid-dwell can change
the run's length, which changes the step size under a clock that has already
started, which changes which frame is on top.

### 1.1 The composition is decided entirely by shared dials

Worth writing down, because the natural assumption is that a `solo2`
composition problem is dialled in the `solo2` section, and it is not. Where
the picture sits and how big it is comes from three dials, all in `shared`:

| dial | namespace | default | what it decides |
|---|---|---|---|
| `panelPreset` | shared | `dell`, **1080 × 1920 portrait** | the panel geometry every other measurement is derived from |
| `captionLayout` | shared | `inset` | full-bleed picture, or inset on black with the caption below |
| `pictureHeight` | shared | 87 | the inset picture's height as a percent of the panel |

`solo2`'s own namespace holds only timing and transitions: `cameraRun`,
`transition`, `fadeS`, `sameCameraFadeS`, `leadS`, `leadScale`. None of them
can move a picture.

**Leading hypothesis: `panelPreset`.** Its default is portrait, the solo
kiosk runs landscape, and `pictureRect` derives the inset picture from the
panel's aspect ratio. A portrait preset against a landscape screen produces
a wrong composition that is not wrong anywhere else. The same setting caused
the "previews are portrait" line in the camera-run spec's §1 on 2026-09-05,
so this is a repeat, not a new failure. The glass is the KTC panels in
landscape, so the value should be `ktc-l`.

Two other explanations to rule out in the same pass:

1. **The profiles.** Studio dials and live dials are separate rows. The
   studio previews `studio`; the glass runs `live`; Deploy copies one to the
   other. Dials moved without a Deploy never reach the glass.
2. **`activeVersion`,** also in `shared`. If it still reads `solo`, none of
   the `solo2` work is drawing at all. The reported same-camera dissolves
   argue it is on `solo2`, since `solo` has no such transition, but it costs
   nothing to confirm.

Reading the live values needs an owner session, so this is Jesse's to check
on `/studio`, not something a session can settle from here.

## 2. The decision

**The dwell stops being a fixed length the run divides. It becomes a budget
the frames share, with a floor on how short a frame may get. Past the floor
the dwell stretches rather than the frames shrinking.**

Every frame in a run holds for the same length. There is no longer, final
hold: an earlier draft of this design gave the last frame its own 20 s and
that is rejected. A run is a timelapse, and a timelapse has one step.

## 3. The budget rule

```
perFrame = max(minStepS, dwellS / n)
total    = perFrame × n
```

where `n` is the number of frames the run plays, after the caps in §4.

At `dwellS` 20 and `minStepS` 4:

| frames | each | total |
|---|---|---|
| 1 | 20 s | 20 s |
| 2 | 10 s | 20 s |
| 3 | 6.7 s | 20 s |
| 5 | 4 s | 20 s |
| 6 | 4 s | 24 s |
| 8 | 4 s | 32 s |

One image holds the full 20 s. Eight images run 4 s each for 32 s. Neither is
a special case; both fall out of the same two numbers.

### 3.1 The stretch threshold

The dwell stays exactly `dwellS` while the budget can still give every frame
at least the floor, and stretches only past that point:

```
n* = floor(dwellS / minStepS)     // 5 at 20 s and 4 s
```

At or below `n*` frames the total is `dwellS`. Above it the total is
`n × minStepS`. The studio should print `n*` beside the floor dial, because
it is the number that tells an operator whether a cap will ever stretch the
clock.

### 3.2 Why the floor cannot bound the dwell on its own

Once the floor binds, the total grows linearly with the frame count and has
no ceiling. See §4.4 for how large `n` actually gets. A polar camera would
hold the screen for nearly ten minutes. The only way the floor alone could
bound the total is by letting frames get arbitrarily short, which is the
flicker this design exists to remove. **The frame cap is not an extra rule
bolted on top of the budget. It is what makes the floor safe.**

## 4. Frame caps, per bin

Two caps, one per bin, on the number of frames a run may play.

| dial | value | each | worst-case dwell |
|---|---|---|---|
| most frames, sunset | 8 | 4 s | 32 s |
| most frames, non-sunset | 3 | 6.7 s | 20 s |

Jesse's reasoning, 2026-09-06: **we want to see a sequence of sunsets, and we
do not want to see a long sequence of non-sunsets.** A sunset timelapse is
the point of the run. A non-sunset run still beats a single non-sunset still,
so non-sunsets keep motion rather than being cut to one frame. They just must
not hold the screen for longer.

### 4.1 Below `n*`, the non-sunset dial buys pictures, not time

This is the property that makes the split work, and it is worth stating
plainly because it is not obvious from the formula. At or below `n*` from
§3.1, the budget is merely divided more finely, so the **total is always
`dwellS`** whatever the cap says:

| non-sunset cap | each | total |
|---|---|---|
| 1 | 20 s | 20 s |
| 3 | 6.7 s | 20 s |
| 5 | 4 s | 20 s |

So the non-sunset dial controls how many pictures a non-sunset shows, never
how long it holds the screen. It cannot produce a long sequence at any
setting, because it runs out of room at `n*` before the clock is affected.
Any value above `n*` would start stretching, so the studio should mark `n*`
on this dial as the point where that begins.

The default of 3 is a deliberate step below the threshold: brief motion in
exactly the screen time a single still costs today.

**Invariant: at the defaults, the budget floor is a sunset-only mechanism.**
The non-sunset cap of 3 sits below `n*` of 5, so a non-sunset run can never
reach the floor and can never stretch the dwell. Measured on the live log,
every draw that reaches the floor today is a sunset. This is a relationship
between three dials, `runFramesOther`, `dwellS` and `minStepS`, and it is
invisible in any one of them.

It stops holding the moment someone raises `runFramesOther` above `n*` or
lowers `minStepS` so that `n*` falls to 3 or less. Either would let
non-sunsets start stretching the clock, which is the one thing §4 exists to
prevent. The studio marking `n*` on the cap dial (above) is what makes the
breach visible at the moment it is dialled rather than an evening later.

### 4.2 The window sits against the newest frame

When a camera has more frames than its cap allows, the run plays the
**newest** `n` of them, ending on the chosen frame.

Playback order is unchanged and non-negotiable: oldest to newest, sun going
down. "Newest `n`" selects the window, not the direction. Taking the oldest
`n` instead would play frames from hours earlier and then cut to the chosen
one, skipping the middle of the descent. At high latitudes that window could
be broad daylight.

### 4.3 Dropped frames are not marked shown

`shown2` returns the capped run, not the whole group, so a frame the cap
dropped is never stamped `last_shown_at`. Since the camera rests as one unit
and the window always ends on the newest frame, the oldest frames of a long
residency will never reach the glass; they expire at 24 h.

That is accepted. A window that walks forward across successive draws of the
same camera would fix it, but it needs a per-camera cursor, which is a fifth
rule for a case that only arises at high latitude. Deferred, not rejected.

### 4.4 Where the frame counts actually come from

The cron admits at most one frame per camera every 10 minutes. A camera stays
in the bin while its sun sits inside the swept altitude band, normally 22
degrees wide, from -24 to -2. It leaves roughly half an hour after the sun
exits the band, and everything expires at 24 h regardless. So the frame count
is the band crossing divided by ten minutes:

| where | band crossing | frames |
|---|---|---|
| equator | ~1.5 h | ~9 |
| 45 degrees | ~2 h | ~12 |
| 60 degrees | ~3 h | ~18 |
| high latitude near solstice | many hours | up to 144 |

When a feed goes thin the sweep escalates and widens the band to roughly 38
degrees, so residency grows for every camera in that feed at once.

## 5. The clock leaves the grid

Totals now vary by camera, from 20 s to 32 s. `slotFor` is
`floor(now / dwellS)` on Unix time, so it cannot survive that. The server
takes the dwell instead.

1. On advance, the server already picks the camera, so it can build the run
   and knows the dwell's length. It stores an end time beside `shown_since`.
2. The glass waits for that end time instead of computing a boundary.
3. `slot` becomes a monotonic counter, `current + 1`, not a function of the
   clock. Idempotency is unchanged: `kiosk_screen_state.slot` already stores
   it and `advance` already gates on `screenBefore?.slot !== slot`. The
   `SLOT_TOLERANCE` check against a server-computed slot is replaced by a
   check that the posted slot is the stored one plus one.
4. A tab loading mid-dwell reads the start and end from the state route and
   joins at the right frame. `stageAt` already does this and does not change.

The counter still satisfies what depends on it. `kiosk_draws` is
`PRIMARY KEY (feed, slot)`, so a slot must stay unique and monotonic per
feed, which `current + 1` is by construction. Nothing else keys on the slot
being derivable from a clock.

It does change the *kind* of idempotency `advance` has, which needs a test
rather than an assumption. Today it is idempotent by value: the client
computes a slot from its own clock and two tabs computing the same slot
collide harmlessly. With a counter it becomes compare-and-set against the
observed slot, so two tabs racing the same advance depend on the update
being conditional on what was read. The existing write already has that
shape, `where kiosk_screen_state.slot is distinct from excluded.slot`, so it
should survive, but "should survive" is what the test is for.

### 5.1 The server publishes the end as an instant; no client computes a length

Recommended by the replay session on 2026-09-06 and adopted. It is the
decision that makes the rest of §5 small.

**The server owns *when this dwell ends*. The client owns *how far along we
are*.** `StateView` already carries `current.shownSince`; one field beside
it, the instant this dwell ends, is the entire interface change.

The argument is that a dwell end has stopped being a function of the clock
and a dial and become a function of engine state, namely `n` after the caps.
Only the server knows `n` at draw time. Any client that recomputes the end
has to re-run enough of the engine to know `n`, which is duplicated logic
that drifts, and it drifts silently because the output stays plausible.

Every render site keeps interpolating locally for smoothness. It just
interpolates toward a supplied instant instead of deriving one. The tape's
`Playhead` swaps its `dwellS` prop for an `endsAtMs`, which is a smaller
change than a version branch would have been.

**This is what collapses §6.2.** A client rendering toward an instant does
not care which version produced it, so twelve version branches at render
sites become zero, and the only branch left is the one place on the server
that computes the instant. That is why this belongs inside §5 rather than as
tidying afterwards.

### 5.2 `dwellMs` joins the version spec

**The dwell's length must be a pure function of the entries, the dials and
the pick, exported from the engine, not computed inside the renderer.**
Raised by the replay session on 2026-09-06 and adopted here. Without it,
`replay()` cannot reconstruct history at all, and anything else that has to
know how long a draw occupies the glass has to re-derive it and will drift.

It costs nothing, because it already exists under another name. `shown()` in
`SoloVersionSpec` returns the frames a draw puts on glass, and after §4 that
is exactly the capped run, so its length is the `n` of §3:

```ts
/** How long a draw of `pick` occupies the glass, ms. Pure. */
dwellMs(entries: BinEntry[], pick: BinEntry, d: D): number;

// solo2: perFrame × n over shown(), per §3
// solo:  d.dwellS * 1000, always
```

`solo` returns the constant, so the fixed grid and this function agree for
it and nothing about `solo` changes.

Consequences for callers:

- `advance` uses it to stamp the dwell's end time (§5, step 1).
- `replay()` stops being a slot loop and becomes a clock loop **for the
  projected half only**: start at `fromMs`, ask `dwellMs` what the draw
  costs, advance by it, repeat. Its three uses of `slotFor` and `boundaryMs`
  go away with the loop.

#### `dwellMs` must never be used to date a recorded draw

**A past draw's duration is measured, never computed.** The end of a
recorded block is the next row's `shown_at`, which is what the tape already
does. `dwellMs` answers only for the projected half, where there is no next
row yet.

This needs saying because the wrong path looks right and produces confident
wrong dates. `kiosk_draws.shown_snapshot_ids` does make `n` recoverable for
a past draw, and `deploy_id` does name the dials, so the budget rule *can*
be evaluated against a historical row. It must not be. Today's engine
divides a fixed slot however long the run is, so every recorded draw is
20.0 s regardless of `n`, while the budget rule stretches past `n*`. The two
disagree, measured on the live log on 2026-09-06:

| `n` | draws | actual | the rule would say |
|---|---|---|---|
| 5 | 17 | 20.0 s | 20.0 s |
| 6 | 5 | 20.0 s | 24.0 s |
| 7 | 27 | 20.0 s | 28.0 s |
| 8 | 16 | 20.0 s | 32.0 s |
| 10 | 11 | 20.0 s | 40.0 s |
| 12 | 14 | 20.0 s | 48.0 s |

At `n` = 12 the rule overstates a real recorded draw by 2.4×. My earlier
claim that the rule returns `dwellS` for pre-cutover rows holds only at or
below `n*` and is wrong above it. Credit to the replay session for
measuring rather than accepting it.

The conclusion survives, for a different reason than I first gave: no
backfill and no new column are needed, because nothing should ever ask the
rule about the past.

#### The cap is already load-bearing today

The same measurement settles a question §3.2 could only argue in the
abstract. Over 406 stamped `solo2` draws:

| | draws above `n*` | share |
|---|---|---|
| uncapped, as today | 88 | 21.7% |
| capped, as designed | 28 | 6.9% |

The caps are load-bearing from day one, but for a sharper reason than "a
fifth of draws would stretch": they cut the floor's reach by two thirds, and
they cap what is left at 32 s rather than the 48 s the uncapped numbers
suggest. Every draw that still reaches the floor is a sunset:

| bin | capped `n` | draws | dwell |
|---|---|---|---|
| sunset | 6 | 4 | 24 s |
| sunset | 7 | 14 | 28 s |
| sunset | 8 | 10 | 32 s |

Use these figures rather than the uncapped ones. The 21.7% measures a world
without the caps, and the caps are part of the same design.

### 5.3 The screens stop being staggered

`offsetS` is currently a standing stagger on a shared grid. With variable
dwells it becomes a starting phase only, and the two screens will drift into
and out of step with each other over an evening.

Jesse's call. Recommended: accept the drift. Locking them would mean
coordinating two independently-drawn feeds, which is a larger change than
everything else in this document put together.

## 6. The rest rule keeps its meaning; only its bookkeeping changes

The rule does not change. `rest` still means "a frame sits out N draws after
it was on glass."

The problem is that the engine never stores N. It stores `last_shown_at`, a
timestamp, and recovers the draw number by dividing by the dwell length:

```ts
const shownSlot = slotFor(e.lastShownAt, feed, d.dwellS, d.offsetS);
return slot - shownSlot <= d.rest;
```

That works today only because every dwell is exactly `dwellS`, so "three
draws ago" and "sixty seconds ago" are the same statement. Once dwells vary,
sixty seconds ago might be three draws or two, depending on which cameras
were drawn in between, and the division returns a number that is not a draw
count.

The fix is to store the draw number rather than recompute it:

- Migration: `last_shown_slot BIGINT` on `kiosk_bin_entries`, written in
  `commitAdvance`, which already has the slot in hand.
- `isResting` compares stored integers and drops its `feed` and dials
  arguments.
- Four sites currently convert between slot and time and all of them go away:
  `solo/engine.ts` in `isResting` and where `project` stamps
  `pick.lastShownAt`, `solo2/engine.ts` where `project2` stamps the same, and
  `stages.ts` where `drawsLeft` is computed.

Small, but it is a migration plus four call sites plus their tests, not a
rename. Apply the migration before merging the code that reads the column.

### 6.1 The draw number is rest's currency, not just an idempotency token

Raised by the replay session on 2026-09-06, and worth stating outright
because the bullets above read as plumbing and this is why they are not
optional.

Today's conversion between a timestamp and a draw number is free **and
reversible**, because slots are clock-derived: `floor(t / dwellS)` goes one
way, `slot × dwellS` comes back. The moment a slot becomes a counter that
conversion has no inverse. From a timestamp you cannot recover which draw it
was, because the draws in between were not all the same length.

So `rest`, counted in draws, can no longer be measured against
`lastShownAt`, a timestamp. Every site that measures rest changes currency
**in the same step**, not merely gains a column:

| site | today | after |
|---|---|---|
| `isResting` | `slot - slotFor(lastShownAt)` | `slot - lastShownSlot` |
| `stages.ts` draws-until-rested | the same conversion | the same stored integer |
| `project` (solo) | writes `lastShownAt = boundaryMs(slot)` | writes the draw number |
| `project2` (solo2) | the same | the same |

**Why §10's order cannot flip.** Doing §6 first is safe: a stored draw number
written while slots are still clock-derived agrees with a clock-derived
comparison, so the tree is correct at every point. Doing §5 first is not.
Rest would compare a counter against a clock-derived number and rest the
wrong frames, quietly. That produces a plausible-looking queue rather than an
error, which is worse than the half-moved clock this document already warns
about.

### 6.2 Every consumer of the grid

Eleven non-test files read `slotFor`, `boundaryMs`, `nextBoundaryMs` or
`msUntilBoundary`. Listed so none is found late:

| file | what it uses the grid for |
|---|---|
| `app/lib/solo/engine.ts` | `isResting`, and `project` stamping `lastShownAt` |
| `app/lib/solo2/engine.ts` | `project2` stamping `lastShownAt` |
| `app/lib/solo/stages.ts` | draws-until-rested |
| `app/api/kiosk/solo/advance/route.ts` | server-side slot validation |
| `app/api/kiosk/solo/view.ts` | `firstSlot` for the projection, and the current slot |
| `app/components/solo/useSoloGlass.ts` | the glass's clock and boundary timer |
| `app/components/solo/schedule.ts` | the `msUntilBoundary` wrapper |
| `app/components/solo/index.tsx` | debug overlay countdown |
| `app/components/solo2/index.tsx` | dwell start, debug overlay countdown |
| `app/studio/solo/FeedColumn.tsx` | the studio's "next in N s" countdown |
| `app/lib/solo/replay.ts` | start and end slots, evaluation moment, `lastShownAt` write |

Plus a twelfth that reads `dwellS` directly rather than the grid, found by
the replay session on 2026-09-06 and verified here:
`app/studio/solo/Tape.tsx`'s `Playhead` uses `dwellS` twice, as the CSS
`animationDuration` and as the denominator of `elapsedS / dwellS`. Under a
budget it sweeps at the wrong rate and reaches the seam early, by exactly the
factor `n` exceeds `n*`. The tape's past blocks are fine: they measure from
the next draw's `shownAt`, which is §5.2's measured-not-computed rule already
doing its job.

`FeedColumn.tsx` and the `Playhead` are the two that matter most, because
both are surfaces Jesse reads and both would show a confident wrong number
rather than break.

An earlier draft of this section said each of these sites needs a
`solo`-versus-`solo2` branch. **That is wrong, and §5.1 is why.** A client
handed an end instant does not need to know which version produced it.

An alternative Jesse raised: rest a camera until it has a new frame, rather
than for N draws. That is a genuine behaviour change and a reasonable one now
that the camera is the draw unit, but it is not needed to make the clock work
and it is not part of this design.

## 7. The caption fixes — DELIVERED by PR #153, not by this design

Both were independent of the timing work, and another session built them
before this spec got a branch. **PR #153, `fix/solo2-caption-fades`, is the
implementation; nothing in §7 is left to build here.** It covers rows 1 and
2 of §1, so the flicker Jesse reported is addressed there.

| specified here | shipped in #153 |
|---|---|
| move the caption inside the arrival wrapper so it dips or crossfades with the picture | done, tested by asserting the caption layer's animation string equals the stack's, with the veil painted between the old words and the new |
| caption the drawn entry rather than the frame that is up, dropping the per-frame time | **better.** The caption layer is keyed on the drawn frame so a step cannot remount it and the title and place hold still, but the time is kept and dissolved: out over the first half of the same-camera fade, in over the second, never overlapping, and not at all when two frames of the same minute would say the same thing. |

The second row is the interesting one. This spec proposed removing the
per-frame time because it was the thing reflowing. #153 kept it and fixed the
reflow instead, which is the better answer: the clock is real information and
a run is the one place it visibly advances.

**One thing to confirm on glass rather than assume.** §1 traced the place
line's flicker to the whole line being conditional on there being place text
or an inline time, so a frame missing a timezone or a sun altitude collapses
it. Keying the layer stops the remount, but if the time string itself goes
empty mid-run the line can still vanish and the block still reflows. Worth
one look at a camera with patchy timezone data before calling that symptom
closed.

## 8. Dials

Added to the `solo2` namespace:

| key | label | default | notes |
|---|---|---|---|
| `minStepS` | shortest frame (s) | 4 | the floor; studio prints `n*` beside it |
| `runFramesSunset` | most frames, sunset | 8 | ceiling 32 s |
| `runFramesOther` | most frames, non-sunset | 3 | never stretches; see §4.1 |

Reused unchanged: `dwellS` (20) is now the budget rather than the fixed
dwell, and its description must say so. `cameraRun` still switches the whole
mechanism off.

Removed: nothing. `fitPlan`'s even division becomes the `n <= n*` branch of
the budget rule, so a run at or under the threshold behaves exactly as it
does today.

## 9. Open

1. **The composition mismatch** is the one item here that is not a design
   question. §1.1 names the three shared dials and the leading hypothesis;
   reading their live values needs an owner session, so it is Jesse's check
   on `/studio`.
2. **The residual place-line reflow** in §7, if it survives #153.
3. **The walking window** (§4.3) is deferred.

4. **Authorisation.** Jesse approved the design in conversation and asked for
   this write-up. He has not said to build it. Nothing here is started.

Settled since drafting: the screen stagger (§5.3), which Jesse accepted on
2026-09-06; and where the dwell length is computed, which §5.1 answers with
the server publishing an end instant and no client deriving one.

## 10. Build order

0. ~~The caption fixes~~ — delivered by PR #153, see §7.
1. **The rest currency (§6, §6.1).** Migration first, applied before the
   merge. Not just the column: `isResting`, `stages.ts`, `project` and
   `project2` all move to the stored draw number in this step. Safe on its
   own, because a stored number and a clock-derived comparison still agree
   while slots remain clock-derived.
2. The server-published end instant (§5.1) and `dwellMs` on the version spec
   (§5.2), and with them every consumer in §6.2 including the replay, the
   studio countdown and the tape's playhead. §5.1 first: once the end is
   published, the render sites stop needing to know anything about versions.
3. The budget rule and the per-bin caps (§3, §4), including the studio
   readout of `n*`.

**Step 1 must precede step 2 and the two must not be split across a merge.**
The reasoning is §6.1: reversing them makes rest compare a counter against a
clock-derived number, which rests the wrong frames quietly. Step 2 spans
lanes, so the replay half belongs in the same PR rather than a follow-up.

## 11. Provenance

Drafted 2026-09-06 in the `feat-one-studio` worktree, which was pruned once
its branch merged; the spec was untracked and survived only because it had
been parked outside the repo. It is now a commit on
`feat/solo2-dwell-budget` (PR #154), which is the only copy that matters.

Reviewed across four rounds by the solo-replay session before any code was
written. It supplied the measurements in §5.2 and §4.1, corrected two claims
of mine, contributed §6.1 and §5.1, and found the twelfth grid consumer. Its
corrections are marked where they land rather than collected here.
