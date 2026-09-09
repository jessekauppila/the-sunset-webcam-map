# Instagram prelude bank — a hand-posted feed of camera runs

**Date:** 2026-09-08
**Status:** design, approved in chat; nothing built.
**Branch:** `docs/instagram-prelude-bank`
**Scope:** stage one only. A script that assembles posts; a human uploads them.
API publishing is named in §10 and deliberately excluded.

## 1. What this is

The project needs an audience before the 2026-09-12 show. The material for
one already exists in the archive: a camera's consecutive frames through a
single sunrise or sunset are an arc, and swiping through them is the sunset
developing. That arc is what solo2 calls a camera run and what Jesse calls a
prelude series.

This spec defines a **bank**: the best twenty sunrise series and the best
twenty sunset series in a window, rendered to Instagram-ready cards with
captions written, sitting in a folder waiting to be posted by hand.

No Meta app, no access token, no cron, no production write. The script reads
the database and the image host and writes files to disk.

## 2. What the data actually contains

Measured against production on 2026-09-08 over the preceding seven days.
Frames were clustered into series by the rule in §4.

| | |
| --- | --- |
| Frames in the window | 43,861 |
| Frames carrying `ai_regression_score` | 43,861, all of them |
| Frames carrying `llm_quality` | 0 |
| Series after clustering | 7,751 |
| Series of 6+ frames | 3,259 |
| Candidate series after every gate, sunrise / sunset | 413 / 494 |
| Median gap between frames in a series | 10.3 minutes |
| Typical candidate series | 8 frames, about 80 minutes |
| Series of 6+ frames missing an image URL | 0 |

Three consequences, each of which decides something below.

**Rank on `ai_regression_score` alone.** Claude scoring campaigns stopped
2026-07-31, so `llm_quality` is null on every frame in the window. The v4
regression score covers all of them. This sidesteps the mixed-instrument
problem documented at the top of `app/api/leaderboards/route.ts`, where the
public board silently ranks two different measuring devices against each
other. The bank ranks one instrument over one window and has no such seam.

**Ten minutes between frames is an arc, not a movie.** Eight frames span
about eighty minutes, which is most of a golden hour. Played as video that
is a one-second flicker; swiped as a carousel it is a story.

**Every stored frame is 400 by 224 pixels, about 15KB.** This is the hard
constraint on the whole design and §6 exists because of it.

## 3. Decisions

1. **A series is one camera, one solar event.** Not one camera-day: a
   camera-day spans 9.4 hours at the median and contains both a sunrise and
   a sunset with daylight in between.
2. **Sunrise and sunset are ground truth from the sun**, via
   `solarPhaseAt` in `app/lib/solarPhase.ts`, not the stored `phase` column
   and not `llm_is_sunrise`. That module measured those two disagreeing with
   the sun on 17% and 31% of leaderboard-eligible frames respectively.
3. **Rank on half the peak score and half the series mean.** Peak alone
   promotes a series with one lucky frame; the measured example is an Alaska
   highway camera with a peak of 0.967 and a mean of 0.491, which is seven
   dull pictures and one good one. A carousel is judged by all of its frames.
4. **One series per camera in the bank.** Without the cap, three of the top
   eight sunrise series were the same North Dakota camera. A feed of the same
   three cameras is not a feed.
5. **Sunrise and sunset are separate posts that alternate.** Not one
   combined carousel: interleaved, the light climbs and then falls, which
   reads as a mistake rather than as a contrast.
6. **The picture is inset on a dark card, never full-bleed.** §6.
7. **The caption carries no model score.** §7.
8. **Carousel, not video.** §8.

## 4. The series

`preludeSeries(frames)`, pure, in `app/lib/prelude/series.ts`.

Input is frames for one camera ordered by capture time, each carrying a
timestamp, a regression score, a binary score, an image URL, and the camera's
latitude and longitude. A new series starts when any of these is true:

- the gap from the previous frame exceeds **45 minutes**, or
- `solarPhaseAt` returns a different phase than the previous frame's.

The gap threshold sits well above the 10.3-minute median cadence and well
below the hours of daylight that separate one event from the next.

A series is a **candidate** when all of these hold:

| gate | value | why |
| --- | --- | --- |
| frames | at least 6 | fewer is not an arc worth swiping |
| `max(ai_binary_score)` | at least 0.5 | the detector agrees something happened |
| image URLs | all present | a hole in a carousel is worse than a shorter one |

A series is trimmed to **10 frames**, centred on its highest-scoring frame
and kept in capture order. Instagram permits more, but ten frames ten minutes
apart is already eighty minutes of sky, and swiping past that is a chore
rather than a story. The cap is editorial, not a platform limit.

### 4.1 The timestamp trap

`webcam_snapshots.captured_at` is `timestamp WITHOUT time zone` holding UTC
digits, and the Neon driver returns it as a Date shifted by the server's
local offset. Every query here reads it as `captured_at AT TIME ZONE 'UTC'`.
Getting this wrong moves every sun altitude by hours, which silently
mislabels the phase of every series. `app/lib/solarPhase.ts` carries the same
warning.

## 5. The bank

`buildBank(series, { limit: 20 })` in `app/lib/prelude/bank.ts`, pure.

Score each candidate as `0.5 * peak + 0.5 * mean` over `ai_regression_score`.
Sort descending. Walk the sorted list and take a series only if its camera is
not already in the bank. Stop at twenty. Do this once per phase.

The result of running this on 2026-09-08 over seven days, as a sanity check
on the whole idea: Easter Island, Norfolk Island, Mount Yasur in Vanuatu,
Broome, Spiekeroog, Iceland, Kazakhstan, Kenya, Lake Crescent.

## 6. The card

**The constraint.** Every archived frame is 400 by 224. Windy's API offers no
larger still: its `images.sizes` tops out at exactly that preview size. An
undocumented path, `images-webcams.windy.com/37/<id>/current/full/<id>.jpg`,
does serve 640 by 360, but only for a camera's *current* frame, so it cannot
reach back into the archive. See §11.

**The consequence.** Do not upscale to full bleed. A 2.7x upscale of a 15KB
JPEG, viewed full-screen on a phone, looks like a mistake.

**The card.** 1080 by 1350, Instagram's 4:5 portrait. The frame is drawn at
2x, so 800 by 448, centred horizontally with generous margin, on a dark
ground. The caption sits below its foot. A small picture inside a deliberate
frame reads as a choice; the same pixels stretched to the edges read as a
failure.

This is not a new layout. It is the solo kiosk's inset composition, which
already puts a picture on a dark panel with the caption hanging below it. The
feed and the glass should look like the same object, and here that costs
nothing.

**The seam with the glass.** Reuse `app/lib/solo/caption.ts` for the *words*,
which is where the project's voice lives and which is already pure and
tested. Re-express the *layout* as SVG composited by `sharp`, which is
already a dependency. Do not try to run the React components headless: the
words are the part worth sharing, and the layout is thirty lines of SVG.

Render with `sharp`, sRGB, quality 90, no chroma subsampling, so the
compression artefacts already in the source are not compounded.

## 7. The caption

Built from `captionLines` and `timeSegments` in `app/lib/solo/caption.ts`,
using the peak frame of the series:

- the camera title, cleaned, prefixed `Sunrise: ` or `Sunset: ` from
  `FEED_PREFIX`
- the place, region and country
- the local clock where the camera is, and the sun's altitude

Then, written by this script rather than borrowed: the span of the series in
minutes and the frame count, so the reader knows what they are swiping
through.

**No model score in the caption.** It is an internal instrument on a scale
nobody outside the project can read, and printing it invites arguing with the
number instead of looking at the picture. The score is recorded in the
manifest (§8) so the bank stays auditable.

## 8. Output

One directory per series under `out/prelude/`, git-ignored:

```
out/prelude/2026-09-08/sunset-01-easter-island-mataveri/
  01.jpg … 10.jpg      the cards, in capture order
  caption.txt          ready to paste
  manifest.json        snapshot ids, scores, timestamps, the URLs fetched
```

Carousel order is oldest to newest, always. A sunrise brightens and a sunset
darkens, and that direction is the whole point of the swipe.

`manifest.json` exists so a post can be traced back to its frames after the
fact, and so the script can refuse to rebuild a series that was already
posted.

## 9. Editorial

**Cadence.** Daily from Tuesday 2026-09-09 through Friday 2026-09-12, to
build a feed that exists before the show. Every other day after that. Twenty
per phase is eighty days of feed at that rate, and the weather does not
cooperate on demand, so the bank is what makes the feed look curated rather
than dutiful.

**Alternate the phase.** Sunset, sunrise, sunset, sunrise down the feed. The
contrast is stronger discovered as a rhythm than stated in a caption.

**Post at the audience's evening, not the sunset's.** The frame is from last
night somewhere. Nothing about it expires.

**The simultaneity post.** One combined format is worth having and it is not
a carousel: a single card, best sunrise beside best sunset, captured within
the same hour, captioned with both local clocks. That is the thesis of the
map in one picture. Occasional, not standing. Out of scope here; noted so it
is not re-invented.

**The account.** Create it as a professional account from the start, so the
stage-two API path needs no conversion later.

## 10. Out of scope

- Publishing through the Instagram API. That needs a Meta app, a long-lived
  token that expires on a fixed clock, and public URLs for every image. The
  token failure is silent, which is the same shape as the migration-ledger
  loss, so when it is built it belongs in the daily digest. After the show.
- Reels. More reach than carousels, and the crossfade timing is already
  worked out in solo2, but rendering video means adding ffmpeg. After the
  show.
- Changing what the ingest stores. See §11.

## 11. Open question, for a separate decision

The ingest fetches `images.current.preview` at 400 by 224 in
`app/api/cron/update-cameras/route.ts`. A 640 by 360 original is available
and is what the preview is downscaled from. Switching would improve the glass
as well as the feed, from now on and not retroactively, at roughly 50KB per
frame instead of 15KB. At the measured 43,861 frames a week that is about
2.2GB a week against 0.65GB.

This is a storage-cost decision that touches the kiosk, so it does not belong
to this spec. Flagged here because it was found here.

## 12. Testing

Pure modules, so the interesting cases are all unit tests with no database
and no network:

- **`series.ts`** — splits on a gap over 45 minutes; splits on a phase change
  with no gap; does not split on the median 10-minute cadence; a
  polar-latitude camera whose sun circles without setting is phased by the
  altitude comparison rather than by the azimuth.
- **`bank.ts`** — the blended score orders a high-peak low-mean series below
  a steady one; the per-camera cap drops a camera's second series and takes
  the next camera instead; a bank of fewer than twenty candidates returns
  what it has rather than padding.
- **`series.ts` gates** — a 5-frame series is rejected; a binary max of 0.49
  is rejected; a missing URL rejects the series rather than shortening it;
  an 18-frame series trims to the 10 centred on its peak, in capture order.
- **The timestamp trap** — a fixture whose `captured_at` is read naively
  produces a different phase than one read as UTC. This test exists to fail
  if someone drops the `AT TIME ZONE 'UTC'`.

The rendering and the fetching are checked by looking at the output, which is
the point of a hand-posted stage.

## 13. The run panel, after the show

Written 2026-09-08, after this spec and the run-crossing labeling design
(`2026-09-08-run-crossing-labeling-design.md`, branch `feat/run-crossings`,
draft PR #183) were both drafted the same day. They share a supply problem and
neither noticed the other until now.

### What that spec measured, and what it costs this one

Archive runs are model-selected subsequences, not whole events. Inside 6+ frame
sunset runs over 45 days, 4,864 frames were retained because the two model
heads disagreed and only 66 came from the random trickle arm. A frame enters
the archive mostly where the model was confused.

The consequence for §4 of this spec is precise and worth stating plainly: the
carousels this bank assembles are built from the frames the model found
difficult, and the calm opening and the fading close of an event are exactly
what intake drops. This does not contradict the 10.3-minute median gap measured
in §2, because that gap is measured over retained frames only. The cadence
inside a kept stretch is dense. The ends are clipped.

**This does not block stage one.** Nobody swiping a carousel knows that its
first frame is not the true beginning. Build the bank as specified, on archive
series, and post the pre-show feed from it.

### What changes afterward

The run panel keeps every scored frame for 60 cameras in both solar windows,
stamped `intake_reason = 'run'`, behind a runtime flag. It is held until after
the show on Friday 2026-09-12 because it edits the `update-cameras` cron. Two
revisions follow from it, and both are revisions rather than rewrites.

1. **A second source.** Select on `intake_reason = 'run'` and a run is already
   whole, with no gap-clustering and no holes. Keep the archive path in §4 as
   well; see the tension below.
2. **A better trim than the score peak.** §4 trims to 10 frames centred on the
   highest `ai_regression_score`. The crossing marks give a hand-placed
   `sky_in` and `sky_out`, which is where the watchable part actually starts
   and stops, and a hand-placed `peak`. Prefer marks where a run has them and
   fall back to the score otherwise. This arrives with Leg 1, which has no plan
   yet and needs runs to accumulate first, so it is later than the panel.

### Both phases, and why this spec had a stake in it

The run panel was originally framed around the sunset window. It now retains
both phases, and this feed is one of the three reasons recorded in that spec's
Leg 0: §9 here alternates sunrise and sunset down the feed, so sunset-only
capture would fund half a feed. Decided 2026-09-08.

### The tension, named so it is not discovered later

§5 caps the bank at one series per camera, because three of the top eight
sunrise series were the same North Dakota camera and a feed of three cameras is
not a feed. The run panel points the other way on purpose: it is fixed with
slow rotation, because the labeling experiment wants the *same* camera under
different skies.

At two posts a day a 60-camera panel starts repeating cameras in about a month.
So the panel is an additional source for this bank, never a replacement for the
archive path. If the feed ever outgrows both, the fix is to widen the panel for
its own reasons, not to relax the per-camera cap here.
