# Solo replay — stamped draws and a counterfactual strip

Date: 2026-09-06. Status: approved in conversation, building. Follows the
stages-and-tape design (`2026-09-05-solo-stages-and-tape-design.md` §4) and
the deploy history (`2026-09-05-studio-deploy-history-and-solo-preview-design.md`).

## 1. What this is

Three records answer "what did the glass show, under which dials, out of
what?" and one pure function turns them into "what would it have shown
under other dials?":

| Record | Table | State on 2026-09-06 |
|---|---|---|
| What we showed | `kiosk_draws` | Live since 23:51 PT tonight; one row per screen per slot; pruned at 7 days |
| Dials in force | `kiosk_deploys` | Every Deploy since 09-05, all namespaces |
| What we had access to | `kiosk_bin_entries` | `entered_at` / `removed_at` on every row; removed rows are never deleted, so the pool at any past moment rebuilds from the table |

The gap is that a draw row does not say which version, deploy, or bin
drew it, and solo2's run frames (the ones a dwell plays besides the chosen
one) are not logged, although they are marked shown and so shape later
draws. This spec stamps the draw row, adds a replay function that
re-runs the engine over the recorded pool, and a CLI that prints the
actual strip beside the replayed one. The replay's output is shaped as the
studio tape's data so a later change can mount it as a second strip under
the fact tape ("with these dials"); that strip is not built here.

The question that prompted it: on the sunset screen at midnight PT, 11 of
61 draws had quality under 0.10, four of them from one Petersburg camera.
The rating floor is 1, rule 3 gives every eligible frame one turn per cycle,
and rest is per frame. Raising the floor shrinks a 23-frame bin to 10 and
tightens the loop. The replay answers which dial to move, with numbers,
before it moves on the glass.

## 2. Stamp the draw

Migration `20260906_kiosk_draws_stamp.sql`, forward-only, idempotent,
**applied before the code merges** (CLAUDE.md rule: the writer swallows its
own errors, so a missing column loses draws silently, not loudly):

```sql
alter table kiosk_draws add column if not exists version            text;
alter table kiosk_draws add column if not exists deploy_id          integer;
alter table kiosk_draws add column if not exists bin                text;
alter table kiosk_draws add column if not exists quality            real;
alter table kiosk_draws add column if not exists detection          real;
alter table kiosk_draws add column if not exists shown_snapshot_ids bigint[];
```

`logDraw(feed, slot, entry, version, shown)` writes all of them in the
one insert. `deploy_id` is `(select max(id) from kiosk_deploys)` inside the
same statement: the live profile is only ever changed by a Deploy, so the
newest deploy row is the profile the glass drew with. No extra round trip.
`shown_snapshot_ids` is every frame the dwell played, the chosen one
included; `[snapshot_id]` for solo. Rows written before the migration keep
nulls; readers treat null as "unknown" and fall back to the bin-entry join
for bin and scores.

`commitAdvance` passes the version name and the `shown` list it already
has; the advance route passes `version.name`.

Retention: `DRAW_LOG_DAYS` goes from 7 to 30, so the run up to and through
the show (2026-09-12) survives. Volume at a 20 s dwell is about 8.6 k rows a
day per screen, half a million rows a month, which is small.

## 3. Reading the records

Two store reads, both in `app/lib/solo/store.ts`:

- `listDrawsBetween(feed, fromMs, toMs)` → `DrawRecord[]` oldest first:
  slot, shownAt, snapshotId, version, deployId, bin, quality, detection,
  shownSnapshotIds, joined to the bin entry, snapshot and webcam for the
  same fields `TapeFrame` carries. Bin and scores come from the stamp when
  present, else from the join.
- `listEntriesOverlapping(feed, fromMs, toMs)` → `ReplayEntry[]`: every
  bin row with `entered_at ≤ to` and (`removed_at` null or `≥ from`), as a
  `StoredEntry` plus `removedAt`. Scores are the admission-time values the
  row holds, which is what the engine saw.

## 4. The replay (pure)

`app/lib/solo/replay.ts`. No I/O, no clock.

### 4.1 The pool at a moment

`poolAt(entries, tMs)`: entries with `enteredAt ≤ t` and (`removedAt` null
or `> t`). The shown state (`tally`, `lastShownAt`, `isNew`) is not read
from the row, because the row holds today's values; it is rebuilt:

- `seedFromDraws(entries, priorDraws)`: for each prior draw, every id in
  `shownSnapshotIds` (or the snapshot alone) gets `tally + 1`,
  `lastShownAt = shownAt`, `isNew = false`. Prior draws are the draws
  before the window; the CLI fetches one hour of them so rest and recency
  start true.
- `isNew` at entry: true when another entry of the same camera was active
  at this entry's `enteredAt`, which is the admission rule, then cleared by
  any showing, prior or simulated.
- The starting `ScreenState`: `lastSnapshotId` is the last prior draw's
  snapshot; `sunsetStreak` is the count of consecutive sunset-bin draws at
  the end of the prior draws.

### 4.2 The run

```ts
replay({ feed, version, dials, entries, priorDraws, fromMs, toMs }): Strip
```

Slots run from `slotFor(fromMs)` to `slotFor(toMs)` on the **replay
dials'** dwell and offset, so a replay may use a different dwell than the
glass did; width-is-time absorbs that on the strip. For each slot:
`poolAt(boundaryMs(slot))`, then `version.next`, then `version.shown`, then
the same shown-state update `project` applies (tally, isNew, lastShownAt =
the slot boundary), then `afterShowing`. A slot with no eligible frame
yields a `blank` frame, the tape's black block.

### 4.3 The strip

```ts
interface StripFrame {
  slot: number; shownAt: number; snapshotId: number | null;   // null = blank
  webcamId; bin; quality; detection; title; imageUrl; capturedAt;
  shownSnapshotIds: number[];
  repeat: boolean;   // seen earlier on this strip
}
interface Strip { feed; version; dials: SettingsValues /* deviations */; fromMs; toMs; frames: StripFrame[] }
```

`actualStrip(draws)` builds the same shape from draw records, so the fact
strip and the replay strip are one type. `summarize(strip)` returns draws,
blanks, distinct frames, distinct cameras, repeats, non-sunset share, mean
and minimum quality, a 10-bucket quality histogram, and draws per camera
(top 8). `compare(a, b)` counts slots where both strips drew the same
frame, only when their dwell and offset agree.

## 5. The CLI

`scripts/solo-replay.ts`, run with vite-node so it imports the real engine,
schemas and store through the `@` alias and the vitest `server-only` stub:

```
npx vite-node --config vitest.config.ts scripts/solo-replay.ts \
  --feed sunset --from 2026-09-06T06:51Z --to now \
  --version solo --deploy 4 --dial ratingFloor=2.5 --dial rest=6 \
  --json /tmp/replay.json
```

- `--deploy N` starts from that deploy's namespace for the version;
  omitted, from the newest. `--dial key=value` overrides on top; values are
  sanitized through the version's schema. `--version` defaults to the
  shared `activeVersion` in the chosen deploy.
- `--from` / `--to` accept ISO or `now`; default the last hour.
- Loads `.env.local` into `process.env` before importing the store, since
  `app/lib/db` reads `DATABASE_URL` at import.
- Prints one line per slot with the actual and replayed frame side by side
  (time, bin letter, quality, camera, a `≠` where they differ), then both
  summaries as a table. `--json` writes `{ actual, replay, summaries }`,
  which is the future studio strip's payload.

First use: tonight's sunset window at rating floor 1, 2.5 and 3, and again
at rest 8. The numbers go in the PR.

## 6. Error handling

- Missing stamp columns: the insert fails, `logDraw` warns, the glass keeps
  advancing, the tape loses rows. Hence apply-before-merge.
- Draws older than the bin history (rows from before 09-04) have no entry to
  join; they are dropped from the actual strip with a count in the summary.
- A window before the draw log began replays fine (the pool is older than
  the log) but the actual strip is empty; the CLI says so.
- `removedAt` is the cron's tick time, not the moment the camera left the
  zone; the pool can be up to one tick generous. Noted, not corrected.

## 7. Testing

- `replay.test.ts`: `poolAt` window edges (entered at t, removed at t);
  seeding tally, lastShownAt, isNew and streak from prior draws; **parity**:
  draws generated by `project` over a fixture, fed back through
  `seedFromDraws` + `replay` with the same dials, reproduce the same picks
  slot for slot; a higher floor changes picks; a different dwell puts frames
  on the new grid; a blank slot; `summarize` counts; `compare` refuses
  mismatched dwells.
- `store.test.ts`: `logDraw` writes the six new columns and the max(id)
  subselect; `listDrawsBetween` prefers the stamp and falls back to the
  join; `listEntriesOverlapping` uses both bounds; `commitAdvance` passes
  version and shown ids through.
- Advance route test: `commitAdvance` receives `version.name`.

## 8. Out of scope

- The studio strip itself (mounting the replay under the tape). The
  `Strip` type and `summarize` are its data; a route is a few lines when
  it is wanted.
- Scenarios below the bin: different cron floors or zones need the archived
  snapshots (all 6.8 k a day are archived with scores) and the sweep
  geometry, which is deterministic from time. Possible later; not here.
- Per-camera rest, or any new dial. The replay measures dials that exist.
