# Camera refresh — what it costs, and why the cron is the wrong lever

**Date:** 2026-09-02
**Status:** measured; recommendation is *change nothing*
**Comes from:** `docs/superpowers/plans/2026-09-02-adaptive-terminator-widening-followups.md`
**Related:** `docs/superpowers/specs/2026-09-02-adaptive-terminator-widening-design.md`

## The question, split

The widening design refused to touch cron cadence and left this as a separate
decision with its own price. Two clocks were being conflated in that
conversation and they stay separate here:

- **The camera list** turns over as the terminator sweeps, roughly every 90
  minutes. A 15-minute tick already samples that six times over. Not the ask.
- **The images themselves** are what wanted a 1-2 minute cadence for the
  exhibit. That is the real ask, and it is the only thing priced below.

## The answer

**A 1-2 minute image cadence is not purchasable at any price, because Windy
publishes a new preview every 10.1 minutes.** Nothing downstream — not the
cron, not the CDN, not the browser — can produce a frame that does not exist.

Measured 2026-09-02, 8 active production cameras, 10 samples each over 11
minutes, each request cache-busted so it reached the origin rather than an
edge copy. Cadence is the gap between distinct `last-modified` stamps.

| camera | distinct frames | gaps (min) |
| --- | --- | --- |
| 1622614150 | 2 | 10.1 |
| 1649934103 | 2 | 10.1 |
| 1689792515 | 3 | 10.2, 10.1 |
| 1716072397 | 2 | 20.3 |
| 1737960418 | 2 | 10.2 |
| 1753860434 | 2 | 10.1 |
| 1760443221 | 2 | 10.1 |
| 1793907964 | 3 | 10.2, 10.1 |

Ten gaps, median 10.1 minutes, and the single 20.3 is one camera missing a
slot rather than a different schedule. This is a publishing clock, not a
per-camera property.

## Why the cron cannot help even at 10 minutes

Windy preview URLs are stable per camera and content-updating:

```
https://imgproxy.windy.com/_/preview/plain/current/<webcamId>/original.jpg?v=2
```

The cron stores that URL in `webcams.images`; the browser fetches the bytes
straight from Windy's CDN. Running the cron more often re-stores the same
string more often. Not one pixel changes sooner. The cron is not in the image
path at all.

## What does govern on-glass freshness

Three gates. The first dominates by a factor of four.

1. **Windy's 10.1-minute publishing clock.** The hard ceiling.
2. **`cache-control: public, max-age=150` on the CDN response.** A browser
   holds a fetched preview for 150 s. Already four times finer than gate 1,
   so it adds at most 2.5 minutes of staleness on top.
3. **The kiosk re-creating the image elements.** Already finer than gate 2:
   `useLoadTerminatorWebcams` polls with SWR every 60 s, the store rebuilds
   its arrays on every payload, and `useLoadedTiles` constructs a fresh
   `new Image()` per webcam whenever that array changes.

Worst case on glass is about 12.5 minutes old, typical is around 5. Gates 2
and 3 are not worth touching: eliminating gate 2 entirely would improve the
worst case by 20%, and gate 3 is already doing its job.

The edge cache is looser than `max-age=150` suggests, incidentally. One
camera served an edge copy stamped 17:04:00 at 17:12:30 while a cache-busted
request at 17:14:43 returned one stamped 17:14:15 — the edge had re-fetched
at a moment when the origin was itself between publications. That is a
consequence of gate 1, not a separate problem.

## What raising the cron cadence would cost

15 minutes to 2 minutes is 96 ticks/day to 720: a 7.5x multiplier on
everything the tick does, for zero image freshness.

| axis | today | at 2 minutes |
| --- | --- | --- |
| Windy cluster calls | ~2,980/day (31 boxes x 96) | ~22,300/day |
| Frames scored (ONNX) | 5,400-7,450/day, measured | damped by the image-hash cache, but the cache only helps because most polls would find *the same frame* |
| Neon compute, whole project | 2.5-3.3 CU-hr/day, measured | the cron's share x 7.5 |
| Vercel function time | 96 x tick duration | 720 x tick duration |
| Image freshness | — | **unchanged** |

The Neon figure needs care: 2.5-3.3 CU-hr/day is the whole project, roughly
$0.35-0.46/day at the $0.14/CU-hr the digest assumes, and the cron is only
part of it. If the cron were even half, 7.5x on that half is about
+$1.30-1.70/day, turning a $13/month bill into roughly $50/month.

Two numbers are **not** measured here and would need to be before any cadence
change: the update-cameras function's wall-clock duration, and the cron's
share of Neon compute. Neither changes the recommendation, because the
benefit side is zero.

The worst cost is not on that table. Windy publishes no rate limit and no
quota headers. 22,300 calls/day is the most likely way to discover a ceiling,
and discovering it makes panels *blanker* — the outcome the widening feature
exists to prevent.

## Recommendation

**Change nothing.** Do not touch `vercel.json`, and do not add a client-side
cache-buster either — that was the fallback before the 10-minute clock was
measured, and against a 10-minute publisher it would burn roughly 0.6 MB of
kiosk bandwidth per cycle (53 cameras at a measured 5.3-18.0 KB, mean 11.1
KB) to re-fetch bytes that are usually identical.

**If 1-2 minute freshness is genuinely required for the exhibit, Windy is the
wrong source and no amount of tuning fixes that.** The custom Pi cameras are
the only path to it, since their upload cadence is ours to choose — see
`docs/device-protocol.md`. That is a hardware and bandwidth decision, priced
separately, and it does not touch the cron.

## A different question the numbers did raise

The cron ticks every 15 minutes against a 10.1-minute publisher, so it is
slightly *coarser* than the source: some published frames are never scored,
and the leaderboard never sees them as candidates. Matching the cron to the
publishing clock at 10 minutes would cost 1.5x rather than 7.5x and would
stop dropping frames.

This is a **scoring**-coverage argument, not an image-freshness one, and
nobody has asked for it. It is written down so it does not get folded into an
image-freshness change silently, and so the 1.5x option is on the table if
frame coverage ever turns out to matter for the leaderboard.

## Facts this rests on, all measured 2026-09-02

| fact | value |
| --- | --- |
| Windy publishing cadence | 10.1 min median over 10 observed gaps, 8 cameras |
| Preview URL shape | `imgproxy.windy.com/_/preview/plain/current/<id>/original.jpg?v=2`, stable per camera |
| CDN cache policy | `public, max-age=150` |
| Preview size | 5.3-18.0 KB, mean 11.1 KB, 80 samples |
| Active cameras | 8 sunrise, 45 sunset |
| Frames scored | 5,403 (9/1), 7,450 (8/31), 6,920 (8/30) per day |
| Neon compute, this project | 2.50-4.84 CU-hr/day over 8/24-9/01 |
| Kiosk payload poll | SWR, 60 s |
| Kiosk image reload | `new Image()` per webcam on every payload change |
