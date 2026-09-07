# solo2: what a camera change dips through

**Date:** 2026-09-07
**Status:** built (PR on `fix/solo2-arrival-segment`)
**Entry point for the model programme:** unchanged — `2026-08-29-two-scale-model-STATE.md`

## 1. What Jesse saw

> "The way the fades are working now in studio solo2, sunrise AND sunset are
> fading to black. Narratively this makes sense for sunsets, but sunrise should
> probably fade to white or crossfade because it's becoming light. It's
> confusing and disappointing if a sunrise fades to black, especially in the
> context of the sunsets fading to black — it looks like the sun is setting and
> it's getting dark."

Two later reports in the same session, both real and both fixed here:

- *"The fade out still seems quicker than the fade in, and this seems more
  pronounced on the sunrise screen."*
- *"The transition down into the new camera kind of snaps in suddenly. If we
  could ease that a little, that would be great."*

## 2. The decision: one dial, four looks, each a PAIR

`veilStyle` says what a camera change dips through. It is a pair — one look per
screen — because the asymmetry is the entire point. The sunset screen ends in
black under all four; the dial is about what a **sunrise** does instead.

| style | sunrise | sunset |
|---|---|---|
| `black` (default) | dips through black | dips through black |
| `crossfade` | no veil at all; one dawn dissolves into the next | dips through black |
| `light` | dips through `veilTint` | dips through black |
| `burn` | blows out into white | darkens into black |

`black` is today's behaviour exactly, so merging changes nothing until the dial
moves. Resolution lives in `app/lib/solo2/veil.ts` (`arrivalLook`), pure and
testable without React.

### 2.1 `veilStyle` only bites on a dip

The existing `transition` dial (cut / crossfade / dip) still says what the
gesture *is*, for both screens. `veilStyle` says what a **dip** dips through.
A screen set to cut or crossfade is already not ending in black, so there is
nothing for the new dial to say and it is ignored.

The one case where the two interact: `veilStyle: crossfade` resolves the
sunrise screen's veil to `null`, and a dip with no veil is rendered as a
crossfade over the whole fade. That is how one screen crossfades while the
other still dips — an asymmetry the single `transition` dial cannot express.

### 2.2 The picture moves toward the veil

`burn` is not "a dip through a white card". The outgoing picture's brightness
ramps toward the veil as the veil closes, and the arriving picture comes back
from it: up into white on a sunrise, down into black on a sunset. `burnLift`
is how far. At 1 there is no ramp and `burn` degrades to a plain dip through
white, which is a useful comparison rather than a broken state.

The lift travels as a CSS custom property (`--solo2-lift`), never interpolated
into the keyframes. Two screens render two `Solo2Frame`s into one document and
a `<style>` rule is global: keyframes carrying a number would have the second
screen's burn silently overwrite the first's.

### 2.3 Why the burn had to stop carrying the timing

The first build ramped brightness alone and Jesse read the two halves as
different speeds. They were not — but brightness is not perceptually linear at
the ends. A picture's highlights clip to white early on the way out and stay
clipped until late on the way in, so a numerically symmetric ramp reads as a
quick departure, a long white, and a late arrival. Sunrise pictures are bright
to begin with, so they clipped soonest, which is why that screen was worse.

The veil's **opacity** carries the timing; the lift only supplies the look.
Opacity over a flat colour is what the eye reads evenly, and it is the same
mechanism the black dip has always used.

## 3. The easing, and the constraint on it

`arrivalEase` — `linear` (today), `gentle`, `soft` — is applied to every layer
of a dissolve: the veil, the outgoing picture, the arriving picture, the
caption, and the steps inside a camera run. Default `gentle`, which is the
change Jesse asked for; `linear` remains available.

**Every curve offered is point-symmetric about (0.5, 0.5)**, and that is a
correctness constraint, not a style preference. A dissolve is two animations,
one leaving and one arriving, matched only while they are the same shape run
in opposite directions. An eased arrival against a linear departure lands in a
third of the time it left in — PR #160, 2026-09-06. `easingIsSymmetric` guards
the table so a later curve cannot be added quietly, and the frame test asserts
both halves carry one value *and* that the value is symmetric.

## 4. Sky-sampled is NOT in this change

The fifth look Jesse compared — the veil taking its colour from the pictures
themselves — needs the browser to read the pixels of a frame. Measured
2026-09-07:

```
curl -I https://storage.googleapis.com/sunrisesunset-32a25.firebasestorage.app/snapshots/…
→ 200, and NO access-control-allow-origin header
```

Without that header the canvas is tainted and `getImageData` throws. It works
in the mockup only because those frames are embedded in the page.

Shipping it anyway would mean a dial that silently renders something else —
precisely the fallback-masquerading-as-real-output failure this project has
already been burned by. **Unblocked by one bucket setting** (a CORS
configuration allowing the site's origin), which is Jesse's to run; after that
it is a small follow-up: sample region, tone toward day/night, and a hold on
the flat colour, all of which the mockup already demonstrates.

### 3.1 One tab owns the change (revised 2026-09-07, after the first look)

Shipped, the dials were split: `transition` (cut / crossfade / dip) stayed on
**Play** labelled *"camera change"*, while the new veil dial sat on **Change**
labelled *"the change"*. Jesse went looking for the exposure settings, found the
Play dial, and reported: *"Camera change tab just shows dip, cut, and crossfade.
It doesn't show the other things."* Two controls, near-identical names, different
tabs — the UI taught the wrong thing.

Everything about one picture giving way to the next now lives on the Change
page, in the order you reason about it: **how it changes** → **how long** → **a
sunrise dips through** → its tint / burn / coverage → **same camera** → **ease**.
`veilStyle`'s `crossfade` option became `none`, because `transition` already owns
that word and a dropdown should not offer the same value under two meanings.

A schema test now asserts the arrival section's exact membership and that no two
dials in the schema share a label.

## 5. The rail gains a page

`Change` sits between `Play` and `Picture`, and appears only for a version
whose schema has an `arrival` section — solo2 alone today. A version without
one falls back to `Play` rather than rendering an empty rail, so the studio
keeps its tab across a version switch.

Grouping the arrival dials onto their own page rather than adding five knobs to
`Glass` also answers the standing note about studio clutter: a new surface
should replace something or stand apart, not thicken an existing column.

## 6. Dials

| key | kind | default | notes |
|---|---|---|---|
| `veilStyle` | enum | `black` | black / crossfade / light / burn |
| `veilTint` | enum | `dawn` | white / dawn / sky / dim; `light` only |
| `burnLift` | number 1–3 | 1.6 | `burn` only; 1 is a plain dip through white |
| `veilCovers` | enum | `picture` | picture / panel; invisible while the veil is black |
| `arrivalEase` | enum | `gentle` | linear / gentle / soft; symmetric by construction |

## 7. Open

- **Glass check.** The burn adds a brightness animation on one full-screen
  layer, on a Pi 4 driving two 1440p Chromium windows. Cheap per-pixel work the
  GPU composites, but unmeasured. Watch the glass after the first reload with
  `burn` selected before trusting it for the show.
- **Sky-sampled**, pending the bucket header above.
- The mockup that produced these decisions:
  https://claude.ai/code/artifact/6d65f737-8074-4040-b6a8-6a1c12b9b9b6
