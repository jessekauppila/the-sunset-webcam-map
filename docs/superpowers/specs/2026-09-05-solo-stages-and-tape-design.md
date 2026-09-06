# Solo studio: least-recently-shown ordering, staged bins, and the tape

Date: 2026-09-05. Status: approved in conversation, not built. Follows the
solo kiosk design (`2026-09-04-solo-kiosk-design.md`, spec §4) and amends
its rule 3.

## 1. What is wrong today

Measured on the live sunset screen at 18:12 PT on 2026-09-05, dials at
their defaults (quality floor 0.55, sunset floor 6, rest 4, dwell 20 s):

| | Count |
|---|---|
| Sunset bin, waiting | 71 |
| of which under the quality floor | 50 |
| of which rested and eligible | 21 |
| Distinct frames in the 8-deep queue | 5 |

The 21 rested frames include the best in the bin (q 0.85). They lose
because rule 3 orders by *least shown* and the five newest arrivals have
tallies of 1–5 against 7–13 for the rest. With rest at 4 draws, five frames
form a closed loop: each is rested again exactly when its turn comes round.
The glass shows the five most recent frames on a 100-second cycle. The loop
widens only as the newcomers' tallies catch up, and every new admission
restarts it. "Least shown first" with a small rest always produces this
shape; the REPEAT tags in the studio queue are that loop.

The studio cannot explain any of this because each bin is sorted by score,
which is not the draw order, so the top row is not "next", and the only
reason a frame carries is FLOOR.

The sunrise screen runs the same code on a different pool: at that hour its
zone is Scandinavia at 3 am, no frame clears the floor, and it loops 24
non-sunsets. Nothing here changes that; it is a pool problem.

## 2. Rule 3 becomes least recently shown

Within the chosen bin, the order is:

1. never shown (`lastShownAt` null) before shown;
2. among never shown: best score, with the promote-new bonus as today;
3. among shown: oldest `lastShownAt` first, then best score;
4. then earlier `enteredAt`, then snapshot id.

Tally no longer orders anything. It is still stored, still counted, and
still shown in the studio and the on-glass overlay.

Consequence: every eligible frame in the bin gets a turn before any frame
repeats, new frames still show promptly, and the rest dial (rule 2) becomes a
hard minimum rather than the thing that shapes the loop. Rule 2's wording
changes from "rests for N draws" to "rests at least N draws".

Worked case, the 2026-09-05 sunset screen (5 new frames, 21 older ones,
rest 4): `New1 … New5, Old1 … Old21, New1 …`, the olds in the order they were
last on glass. Under the old rule it was `New1 … New5, New1 … New5, …` for
tens of minutes.

Code: `compareWithin` in `app/lib/solo/engine.ts` is exported and solo2's
`comparePeak` / `compareValley` (`app/lib/solo2/engine.ts`) are rewritten on
the same shape, so both versions draw the same way; a valley is the same
order with the score reversed. The 2026-09-04 spec gets a history note under
rule 3 like the one under rule 1. `RulesBox` line 3 reads "In a bin: never
shown first, then longest since shown, then best score".

## 3. Staged bins in the studio

### 3.1 The stage classifier

A pure helper, `app/lib/solo/stages.ts`, assigns every active entry one
stage for one feed, from the same inputs `buildStateView` has plus the
projection:

| Stage | Meaning | Detail carried |
|---|---|---|
| `onGlass` | the screen's current frame | — |
| `queued` | in the next 8 projected draws | position 1–8 |
| `inLine` | eligible, rested, not queued | position 9+ when the long projection reaches it |
| `resting` | eligible, shown within the last `rest` draws | draws until rested |
| `underFloor` | below its bin's floor | the floor it misses |

Positions come from one projection of `eligible.length + NEXT_COUNT` draws
with the studio dials (`version.project` is pure; the studio already
re-projects client-side). The queue column keeps showing the first 8. Under
the new rule 3 that projection reaches every eligible frame once before it
repeats, so every in-line frame gets a number.

"Draws until rested" is `rest - (slot - shownSlot) + 1`, with the same slot
arithmetic as `isResting`.

### 3.2 Layout

Each bin is three stacked, outlined boxes in this order: **in line**,
**resting**, **under floor**. Each box carries a vertical label on its left
edge (CSS `writing-mode: vertical-rl` turned so it reads bottom-to-top),
bin-coloured, with the count: `IN LINE · 21`, `RESTING · 0`, `UNDER FLOOR ·
50`. An empty stage stays as a short labelled box so the structure never
shifts. The label text is also the box's hover hint, one sentence each:

- in line: "Rested and above the floor, in the order the glass will draw them."
- resting: "Shown within the last N draws; back in line when the count runs out."
- under floor: "Below the bin's floor dial; never drawn until the dial or the score moves."

Rows inside a stage are ordered by the engine: in line by draw position;
resting by draws-until-rested ascending; under floor by score descending so
the nearest misses sit on top.

The bin header keeps the total and the queued count (`Sunset bin · 71
waiting · 8 queued`); the stage labels carry the breakdown.

### 3.3 The row

`EntryRow` loses the rank number, the bold `shown ×n`, and the FLOOR tag.
It gains one reason line under the title, set by the stage:

| Stage | Reason line |
|---|---|
| queued | `draw 3 · shown ×4 · last 6 min ago` |
| in line | `draw 12 · shown ×13 · last 14 min ago` or `draw 12 · never shown` |
| resting | `back in 3 draws · shown ×5` |
| under floor | `q 0.43 < 0.55` (sunset) or `d 0.21 < 0.30` (non-sunset) |

Scores, title, place and time stay. NEW stays. Queue-only tags (REPEAT,
CAM n/m, PRELUDE, PEAK, VALLEY) are unchanged. Dimming now applies only to
the under-floor stage. This is the studio-clutter direction: one line says
why, and the tags that repeated it go.

## 4. The tape

A horizontal filmstrip per feed, directly under the glass preview and above
the bins: the last 24 draws, the frame on glass, and the 8 projected next,
in one row. It shows movement without animation: the same frame recurring
along the strip, a new arrival cutting in, the seam where fact turns into
projection.

### 4.1 Storage

Draws are not logged today; the store keeps only tally, first and last
shown. New table, migration `20260905_kiosk_draws.sql`:

```sql
create table kiosk_draws (
  feed        text        not null,
  slot        bigint      not null,
  snapshot_id bigint      not null,
  shown_at    timestamptz not null default now(),
  primary key (feed, slot)
);
```

`commitAdvance` inserts one row (`on conflict do nothing`) after the
screen-state upsert succeeds, inside a try/catch that logs and continues,
so a missing table cannot stop the glass advancing. **Apply the migration
before merging the code** (CLAUDE.md rule); a swallowed insert would lose
the tape silently. `maintainBins` deletes rows older than 7 days. Volume: one
row per dwell per screen, about 8.6 k rows a day at 20 s.

### 4.2 Read path

`listRecentDraws(feed, n)` in the store: the last `n` rows by slot, joined to
`webcam_snapshots` and `webcams` for image and title, and left-joined to
`kiosk_bin_entries` on (feed, snapshot id) for the bin, which survives
removal because rows are only marked `removed_at`. `StateView` gains
`tape: TapeFrame[]` (oldest first): `{ slot, snapshotId, imageUrl, title,
bin, shownAt }`. The state route passes `n = 24`.

### 4.3 Render

`Tape.tsx` in `app/studio/solo/`, mounted at the top of `FeedColumn` under
the screen heading, with a `tape ▾/▸` button in the heading that folds it
away (remembered per browser in localStorage). **Width is time**, 3 px per
second of glass, the way a Final Cut timeline reads:

- Past blocks are fact from the draw log, each as wide as the frame stayed
  on glass (from the next draw's time, or the current frame's `shownSince`).
  A frame held past 1.5 dwells because nothing else was eligible reads as a
  wide block with a small `held` mark; blocks cap at 3 dwells.
- The frame on glass wears the orange ring; when nothing is on glass a
  black `blank` block stands in its place.
- A vertical seam separates fact from projection. Projected blocks are
  dashed, one dwell wide at the studio dials, in the queue's order.
- A crossfade is an orange X straddling the cut, as wide as the fade dial
  (live dials on the left of the seam, studio dials on the right). Fade 0
  draws nothing.
- A solo2 dwell with a prelude shows the earlier frames as narrow
  sub-blocks (one prelude step each) before the chosen frame, inside one
  dwell. Past preludes are not logged and are not drawn.
- A frame already seen earlier on the strip carries a thin red top edge,
  the REPEAT tag's colour.
- Hover names the frame, its place, the draw time and the time on glass;
  clicking any block, past included, opens the same detail and rating card
  as a row. The card names the capture time there and, for a past draw,
  when it was drawn. To make that possible a tape row is the whole entry,
  not just an image.
- On mount and whenever the past grows, the strip scrolls so the seam sits
  about two thirds across.

The kiosk does not read the tape.

## 5. Sequencing

Two PRs, both branched from `main` after #140, #141 and #142 merge, since
all three touch `engine.ts`, `FeedColumn.tsx` and `EntryRow.tsx`:

- **PR A** — rule 3 (section 2) and staged bins (section 3). No migration.
- **PR B** — the tape (section 4), PR #TBD. Migration `20260906_kiosk_draws.sql` applied before merge.

After each merge: `bash scripts/pi/kiosk-doctor.sh --sync --reload` for
PR A (the glass runs the engine); PR B is studio-only.

## 6. Testing

- `engine.test.ts`: never-shown first; oldest last-shown next; the 5-new /
  21-old case gives every frame one turn before any repeat; rest still
  excludes; solo2 peak and valley agree with solo on the shown/never-shown
  split.
- `stages.test.ts`: each stage from a fixture; positions match the
  projection; draws-until-rested arithmetic at the boundary.
- `FeedColumn.test.tsx`: three labelled stages per bin with counts, empty
  stage still rendered; `EntryRow.test.tsx`: the reason line per stage, no
  rank, no FLOOR.
- `store.test.ts`: insert on advance, no-op on conflict, read joins the bin;
  `view.test.ts`: `tape` oldest first, length capped.
- `Tape.test.tsx`: seam position, repeat edge, dashed projection.
