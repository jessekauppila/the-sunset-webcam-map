# solo2 — the step ceiling: a run moves at a timelapse rate, and the budget's remainder rests on the newest frame

**Date:** 2026-09-10
**Status:** designed, **not built**, and deliberately not built this week. The
show is Friday 2026-09-12 and today is the freeze. Nothing here touches the
glass before it.
**Amends:** `2026-09-06-solo2-dwell-budget-design.md` §3 (the budget rule) and
§2 (the rejection of a longer final hold — see §2.1 below, which reopens it on
different terms).
**Applies to `solo2` only.** `solo` has no camera run, so it has no step to
bound.

## 1. What prompted it

Jesse, 2026-09-10: *"Right now a solo snapshot is 15 seconds or so. Then we
transition to a timelapse with each image being 2 seconds or so, and that makes
that timelapse really short, confusingly short."*

Two rhythms in one show. A still holds long enough to read the place name and
look at the sky; a run steps past four pictures in the time the still held one.

### 1.1 The premise to correct first, so it is not re-derived

**The dwell is already a budget, and a run already cannot total less than a
still does.** That rule shipped on 2026-09-08 and is live in
`app/lib/solo2/plan.ts`:

```
perFrame = max(minStepS, dwellS / n)
total    = arrivalS + perFrame × n + exitS
```

So the complaint is not about the run's total length. It is about the **rate**:
`minStepS` is the only bound on the step, and if it is dialled near 1 to 2
seconds, an eight-frame run gets a step near 1 to 2 seconds. The first and
cheapest fix is therefore a dial, not code — raise `shortest frame (s)` toward
4 to 6 and the dwell stretches instead of the frames shrinking. That is worth
trying before anything in this document is built, and it can be tried on a
Deploy without a merge.

### 1.2 The part a dial cannot fix

The floor bounds how short a step gets. Nothing bounds how **long** one gets,
because the step is the budget divided by the frame count:

| frames | step at a 20 s budget |
|---|---|
| 1 | 20 s |
| 2 | 10 s |
| 3 | 6.7 s |

A two-frame run holds each picture for ten seconds. That is not a timelapse.
It is two stills that happen to share a camera, and it reads as one more
arbitrary rhythm rather than as the sun going down. A run's rate should be a
property of the run, not of how many frames the cron happened to admit.

## 2. The decision

**Clamp the step at both ends. When the ceiling binds, the run keeps its rate
and the leftover budget is held on the last frame — the newest picture, the one
the run was arriving at.**

```
step  = clamp(dwellS / n, minStepS, maxStepS)
runS  = step × n
total = arrivalS + max(dwellS, runS) + exitS
```

The last frame's step absorbs the remainder, as it already absorbs the exit
burn:

```
restS    = max(0, dwellS − runS)
lastStep = step + restS + exitS
```

### 2.1 This reopens a rejected idea, on different terms

The dwell-budget spec §2 says, and was right to say: *"There is no longer,
final hold: an earlier draft of this design gave the last frame its own 20 s
and that is rejected. A run is a timelapse, and a timelapse has one step."*

The difference is arithmetic, not rhetoric. That draft **added** a full dwell
on top of a run that had already spent one, so a run's total was its own length
plus twenty seconds. This spends no time that the dwell was not already
spending:

- **At every frame count, the total is exactly what it is today.** Below the
  stretch threshold it is `dwellS`, as before; above it the floor binds, the
  ceiling is slack, and the rule is inert. `max(dwellS, runS)` is what
  guarantees this.
- **The run still has one step.** Every frame of the run holds for `step`. The
  rest is not a longer step, it is the dwell finishing on the picture the run
  arrived at, in the same way that a one-frame dwell is a picture holding.

If that reading turns out to be too clever on the glass, the fallback is not to
un-clamp but to lower `maxStepS` until the rest is small.

## 3. The numbers

At `dwellS` 20, `minStepS` 4, `maxStepS` 6:

| frames | step | run | rest on newest | total | vs today |
|---|---|---|---|---|---|
| 1 | — | — | 20 s | 20 s | unchanged |
| 2 | 6 s | 12 s | 8 s | 20 s | was 10 s each |
| 3 | 6 s | 18 s | 2 s | 20 s | was 6.7 s each |
| 4 | 5 s | 20 s | 0 | 20 s | unchanged |
| 5 | 4 s | 20 s | 0 | 20 s | unchanged |
| 8 | 4 s | 32 s | 0 | 32 s | unchanged |

**The rule bites only between 2 frames and `dwellS / maxStepS` frames.** That
is a narrow band, and naming it is the honest way to size the work: at the
default sunset cap of 8, most sunset runs never see it. The runs it changes are
thin cameras, the ends of a camera's residency in the band, and non-sunsets,
whose cap is 3 by default. Whether that band is worth a dial is exactly what
the after-show test decides.

## 4. What it costs to build

Small, and confined to `app/lib/solo2/plan.ts` plus one dial.

1. **`fitPlan`** clamps the step and puts `restS` into `lastStepS`.
2. **`planOf`** is the one that matters, and the one easy to miss. It runs the
   rule **backward**, from the total the server pinned to a step, and it is
   what every live surface renders from. Dividing the pinned total evenly by
   `n`, as it does now, would hand the rest back to every frame and erase the
   effect. It needs the same clamp.
3. **`stageAt` needs no change.** Its index is `min(frames − 1, …)`, so time
   past the end of the last step simply keeps the last frame up. The rest
   falls out of the existing clock.
4. **One dial,** `maxStepS`, labelled *longest frame (s)*, beside *shortest
   frame (s)* in the glass section. Its description should say what the floor's
   says: which frame counts it can reach.
5. **`describePlan`** gains a clause: `3 frames × 6 s · rest 2 s`.
6. **`stepFadeS`** is unaffected. It caps a dissolve at half a step, and the
   step is still one number.

Tests belong on the arithmetic, not the rendering: the total is unchanged at
every frame count, the rest is zero once the floor binds, and `planOf` and
`fitPlan` agree on the same run.

## 5. Open, and what the after-show test is for

1. **Does the rest read as arriving, or as a stall?** This is the whole
   question and it cannot be settled from here. Two- and three-frame runs on
   the glass, watched for a while, in a room.
2. **Rest on the newest frame, or a slower final step?** The spec says hold the
   newest, because the caption's "minutes ago" is about that picture and a
   still picture is what makes the number mean anything. A gradually slowing
   run is the alternative and is more code.
3. **Its own dial, or derived from the floor** (`maxStepS = 1.5 × minStepS`)?
   Own dial, on the argument that the two ends answer different worries, which
   is the same argument `dwellBoost` and `dwellTrim` already settled.
4. **Does the ceiling apply to a boosted sunset?** The boost raises `dwellS`
   for the best sunset present, which under this rule buys it more rest rather
   than a slower run. That is probably right, since the best sunset is the one
   worth sitting on, but it is untested and it is the case most likely to
   look wrong.
5. **Jesse's own framing was dynamic shortening too** — *"we might also
   consider shortening the lengths dynamically."* The rank machinery
   (`runShape`, `dwellBoost`, `dwellTrim`) already does that on the budget.
   Whether the rate should also move with rank is a separate question and
   deliberately not answered here.

## 6. Provenance

Conversation with Jesse, 2026-09-10, from watching the deployed glass. The
observation is his; the correction in §1.1 came from reading `plan.ts` during
that conversation, and the ceiling is the piece his proposal contained that the
budget rule does not already cover.
