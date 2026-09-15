# Instagram prelude bank — a hand-posted feed of camera runs

**Date:** 2026-09-08
**Revised:** 2026-09-15 — posting rights added (§3a), data rechecked (§2, §13),
show deadline removed.
**Status:** design, approved in chat; nothing built.
**Branch:** `docs/instagram-prelude-bank`
**Issue:** #206
**Scope:** stage one only. A script that assembles posts; a human uploads them.
API publishing is named in §10 and deliberately excluded.

## 1. What this is

The project wants an audience beyond the room the glass hangs in. The material
for one already exists in the archive: a camera's consecutive frames through a
single sunrise or sunset are an arc, and swiping through them is the sunset
developing. That arc is what solo2 calls a camera run and what Jesse calls a
prelude series.

This spec defines a **bank**: the best twenty sunrise series and the best
twenty sunset series in a window, rendered to Instagram-ready cards with
captions written, sitting in a folder waiting to be posted by hand.

**What may be posted is decided by where a picture came from (§3a).** The bank
is built and tuned on Windy frames, which may never be posted. Those land in a
stamped practice folder. The ready-to-post folder fills as postable sources
arrive.

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

**Rechecked 2026-09-15.** Windy frames over the preceding seven days: 99,371,
every one carrying `ai_regression_score` and `ai_binary_score`, none carrying
`llm_quality`. The count more than doubled because since 2026-09-05 the solo
kiosk bins save every frame the cron scores (#214). The series counts above
were not re-measured.

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
9. **Posting permission belongs to the source, and the script enforces it.**
   §3a.

## 3a. Posting rights

Decided 2026-09-15.

**The label lives on the source, not the picture.** Whether a picture may be
posted depends entirely on where it came from, so every frame from one source
carries the same answer. The key is `webcams.source`.

| Label | Meaning |
| --- | --- |
| `post` | Terms read, and they allow it |
| `post_with_credit` | Allowed, if the caption names the source |
| `no_post` | Forbidden, **or nobody has read the terms yet** |

Every source starts at `no_post`. Moving one up means someone read its terms,
and the rule records what they read and when.

Sources in the database on 2026-09-15:

| `webcams.source` | Cameras | Label | Largest draw | Basis |
| --- | --- | --- | --- | --- |
| `windy` | 9,044 | `no_post` | 1x | Terms forbid redistribution and stretching |
| `youtube` | 30 | `no_post` | 1x | Terms not read |
| `custom` | 1 | `post` | 2x | Our own camera |

**Windy's terms**, from
https://account.windy.com/agreements/windy-webcams-api-terms-of-use, read
2026-09-15:

- "The User must not further redistribute the Content that they obtain via the
  API."
- "Redistribution of any part of the API or the included data to any third
  party is forbidden."
- Misuse that leads to termination includes "image URL usage other than
  provided by the API" and "stretch the Webcam images (only the original or
  smaller Webcam image size usage is allowed)".
- The Provider may "restrict or completely deny the User the use of the
  Services" at any time without notice. The map and the glass depend on that
  access, which is why one mistaken post matters beyond Instagram.

Building and tuning the bank on Windy frames is inside those terms: nothing
leaves the project. Posting them is not.

**Enforcement is structural, not a reminder.** A label someone has to remember
to check eventually gets missed. So:

- `app/lib/prelude/postingRights.ts` holds the rules, keyed by source. An
  unknown or missing source gets `no_post`.
- The script asks that module where each series goes. `no_post` series are
  written to `practice/` and **every card carries a red "NOT FOR POSTING"
  stamp**. Only `post` and `post_with_credit` series reach `ready/`.
- Each rule sets the largest scale a frame may be drawn at. Windy frames are
  drawn at their stored size, because the terms allow only the original or
  smaller.
- `post_with_credit` series get the credit line appended to `caption.txt`.

Where terms get read: `docs/image-source-register.md` already carries a
license line for each candidate source. A source moves out of `no_post` in the
rules module, with the register as the record of what was read.

**Today nothing is postable in practice.** The one `custom` camera has been
dark since June, and no candidate source from the register is connected yet.
Finding those is deliberately later.

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

The bank ranks every candidate together, whatever its posting label. The
label decides only where a series is written (§3a), so the practice folder
shows exactly what the feed would look like if every source were postable.

The result of running this on 2026-09-08 over seven days, as a sanity check
on the whole idea: Easter Island, Norfolk Island, Mount Yasur in Vanuatu,
Broome, Spiekeroog, Iceland, Kazakhstan, Kenya, Lake Crescent.

## 6. The card

**The constraint.** Every archived frame is 400 by 224. Windy's API offers no
larger still on the free tier: its `images.sizes` tops out at exactly that
preview size. Two undocumented paths serve more. One is
`images-webcams.windy.com/37/<id>/current/full/<id>.jpg`, which returns 640 by
360 for a camera's *current* frame. The other is the day-timelapse embed page,
which lists 1280 by 720 frames, one every ~50 minutes. **Both are ruled out:**
Windy's terms list "image URL usage other than provided by the API" as misuse
(§3a). See §11.

**The consequence.** Do not upscale to full bleed. A 2.7x upscale of a 15KB
JPEG, viewed full-screen on a phone, looks like a mistake.

**The card.** 1080 by 1350, Instagram's 4:5 portrait. The frame is drawn at
the largest scale its source's rule allows (§3a), centred horizontally with
generous margin, on a dark ground. For a postable source that is up to 2x, so
a 400 by 224 frame becomes 800 by 448. A Windy frame stays at its stored 400
by 224. The caption sits below its foot. A small picture inside a deliberate
frame reads as a choice; the same pixels stretched to the edges read as a
failure.

A practice card adds a red band across the top reading "NOT FOR POSTING" and
the source's name. The band sits above the picture at either scale.

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
through. A `post_with_credit` source adds its credit line (§3a).

**No model score in the caption.** It is an internal instrument on a scale
nobody outside the project can read, and printing it invites arguing with the
number instead of looking at the picture. The score is recorded in the
manifest (§8) so the bank stays auditable.

## 8. Output

One directory per series under `out/prelude/`, git-ignored, split by posting
label:

```
out/prelude/2026-09-15/
  ready/                     post and post_with_credit sources only
    sunrise-03-.../
  practice/                  no_post sources; every card stamped
    sunset-01-easter-island-mataveri/
      01.jpg … 10.jpg        the cards, in capture order
      caption.txt            ready to paste
      manifest.json          snapshot ids, scores, timestamps, the URLs fetched,
                             plus source, posting label and destination
```

Posts come from `ready/` only. Nothing in `practice/` is ever uploaded.

Carousel order is oldest to newest, always. A sunrise brightens and a sunset
darkens, and that direction is the whole point of the swipe.

`manifest.json` exists so a post can be traced back to its frames and its
posting basis after the fact, and so the script can refuse to rebuild a series
that was already posted.

## 9. Editorial

**Cadence.** Every other day, once `ready/` has something in it. Twenty per
phase is eighty days of feed at that rate, and the weather does not cooperate
on demand, so the bank is what makes the feed look curated rather than
dutiful. Until then the practice folder is where the look gets tuned.

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
  loss, so when it is built it belongs in the daily digest. Later.
- Reels. More reach than carousels, and the crossfade timing is already
  worked out in solo2, but rendering video means adding ffmpeg. Later.
- Connecting postable sources. `docs/image-source-register.md` ranks the
  candidates, and FAA WeatherCams is #204. Each arrives as `no_post` until its
  terms are read. Later, by decision on 2026-09-15.
- Changing what the ingest stores. See §11.

## 11. Open question, for a separate decision

The ingest fetches `images.current.preview` at 400 by 224 in
`app/api/cron/update-cameras/route.ts`. Larger stills exist, but Windy only
permits them through the API: the free tier limits image size, and the
Professional tier (€9,990 a year) lifts the limit. The undocumented paths in §6
are not an option for the glass either, for the same terms reason.

A larger ingest would improve the glass as well as the feed, from then on and
not retroactively, at roughly three times the bytes per frame. This is a
storage-cost and licensing decision that touches the kiosk, so it does not
belong to this spec. Flagged here because it was found here. Cost context for
the current ingest is on #214.

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
- **`postingRights.ts`** — Windy and YouTube are `no_post`; our own camera is
  `post`; an unknown or missing source is `no_post`; Windy's largest draw is
  1x; only `post` and `post_with_credit` go to `ready/`; a credit line appears
  only for `post_with_credit`.
- **`card.ts`** — a frame at scale 1 is drawn at its stored size; a practice
  card carries the stamp; the stamp clears the picture at either scale.

The rendering and the fetching are checked by looking at the output, which is
the point of a hand-posted stage.

## 13. The run panel

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

**Superseded in part, 2026-09-15.** Since 2026-09-05 the solo kiosk bins save
every frame the cron scores, so archive series are no longer clipped by
intake. An event's ends can still fall outside the band of cameras the cron
sweeps. The measurement is on #214.

**This does not block stage one.** Nobody swiping a carousel knows that its
first frame is not the true beginning. Build the bank as specified, on archive
series.

### What changes afterward

The run panel keeps every scored frame for 60 cameras in both solar windows,
stamped `intake_reason = 'run'`, behind a runtime flag. **It went live on
2026-09-15**: the flag was flipped at 01:38Z, an id-matching fix deployed at
02:16Z, and the first run frame landed at 02:18Z. Panel cameras are Windy
cameras, so run frames are `no_post` like any other Windy frame (§3a). Two
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
its own reasons, not to relax the per-camera cap here. Keeping the best
sequences from any camera each day is a separate idea, #214.
