# Studio deploy history + solo preview on studio dials — design

**Date:** 2026-09-05
**Status:** approved in conversation, this is the written form
**Builds on:** `2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md` (the
studio/live profiles and Deploy), `2026-09-04-solo-kiosk-design.md` §6.4 (the
solo studio)

## 1. What this is

Two changes to the studio, one principle:

> The studio previews what we WANT the glass to show. Deploy sends it. Every
> deploy is kept, so any earlier one can be loaded back into the studio,
> previewed again, and redeployed.

1. **Deploy history.** Every Deploy records a numbered snapshot of the whole
   profile it copied to live. The rail lists them. Loading one puts it in
   the studio profile (preview first); Deploy sends it to the glass.
   Rollback is nothing special: load an older deploy, Deploy.
2. **Solo preview on studio dials.** `/studio/solo` currently draws its panel
   from the live profile and says so; the fade dial does nothing there. It
   changes to the mosaic studio's convention: the panel is a local
   simulation on the studio dials, and the live truth shrinks to one line.

### Naming, decided

- These are **deploys**, numbered `#1, #2, …`, with an optional label. They
  are **not** versions. A version (`v1 … v4`, `solo`, `solo2`) is a
  renderer with its own dial set; a deploy is a take of dial values across
  every namespace, the active version included. "solo v3" would collide
  with the renderer names the day `solo3` exists.
- A deploy snapshots the **whole profile**, not one namespace. Deploy already
  copies every namespace; a snapshot that held only solo dials could not
  restore what was actually on the glass.
- The existing "↩ revert to glass" button becomes **"↩ discard changes"**.
  It still copies live → studio. "Rollback" now means load + Deploy.

## 2. Part A — deploy history

### 2.1 Data: `kiosk_deploys` (new table)

```sql
CREATE TABLE IF NOT EXISTS kiosk_deploys (
  id           SERIAL PRIMARY KEY,            -- the deploy number shown in the rail
  label        TEXT,                          -- optional, renameable
  namespaces   JSONB NOT NULL,                -- { namespace: deviations } exactly as copied to live
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`namespaces` stores deviations from code defaults, the same blob shape
`kiosk_settings.data` uses, so schema drift is handled the same way: a key
the current schema does not know is dropped on load and named in the
response (mirrors `applyNamespace`'s "restored 9 of 11").

The migration seeds **deploy #1** from the current live profile when the
table is empty, so "what was on the glass before this feature" is
recoverable from day one:

```sql
INSERT INTO kiosk_deploys (label, namespaces)
SELECT 'before deploy history', COALESCE(jsonb_object_agg(namespace, data), '{}'::jsonb)
FROM kiosk_settings WHERE profile = 'live'
  AND NOT EXISTS (SELECT 1 FROM kiosk_deploys);
```

Forward-only, idempotent. Applied by Jesse with
`node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql --apply`
before the PR merges (ledger rule).

### 2.2 Store: `app/lib/settings/deploys.ts`

| function | does |
|---|---|
| `recordDeploy(live: ProfileSettings, label?: string): Promise<DeployRow>` | inserts one row from the profile Deploy just copied |
| `listDeploys(limit = 50): Promise<DeployRow[]>` | newest first |
| `loadDeployIntoStudio(id): Promise<{ studio: ProfileSettings; dropped: DroppedKey[] } \| null>` | replaces the studio profile wholesale with the snapshot (delete rows not in it, upsert the rest, one transaction), sanitizing each namespace through its current schema; unknown namespaces are dropped and named; `null` when the id does not exist |
| `relabelDeploy(id, label: string \| null): Promise<boolean>` | rename; false when missing |

`DeployRow = { id, label, namespaces, deployedAt }`.

Missing table: `recordDeploy` and `listDeploys` catch and warn, returning
`null` / `[]`. Deploy must never fail because history could not be written,
but it must not pretend either (§2.3).

### 2.3 Routes (all owner-gated, `force-dynamic`, nodejs)

| route | change |
|---|---|
| `POST /api/kiosk/settings/deploy` | after `copyProfile` + cache warm, `recordDeploy(live, body.label?)`. Response gains `deploy: DeployRow \| null`. `null` means history was not recorded; the client shows it. |
| `GET /api/kiosk/deploys` | `{ deploys: DeployRow[] }` |
| `POST /api/kiosk/deploys/[id]/load` | `loadDeployIntoStudio`. 404 when missing. `{ studio, dropped }`. |
| `PATCH /api/kiosk/deploys/[id]` | `{ label }` → `{ ok: true }`; 404 when missing; 400 on a non-string/over-60-char label. |

Loading touches only the studio profile. The glass changes only on Deploy,
which is the point: preview, then send.

### 2.4 Client: `useStudioSettings` additions

```ts
deploys: DeployRow[];                       // SWR on GET /api/kiosk/deploys, refresh 30 s
deploy: (label?: string) => Promise<void>;  // unchanged signature for existing callers
loadDeploy: (id: number) => Promise<DroppedKey[]>;
relabelDeploy: (id: number, label: string | null) => Promise<void>;
lastDeployRecorded: boolean | null;         // null until a deploy happens this session
```

`loadDeploy` behaves like `revert`: cancel pending PATCHes, POST, replace
`studio` in the SWR cache, clear the optimistic overlay, then revalidate
`deploys` (badges depend on it). `deploy` revalidates `deploys` after the
POST.

### 2.5 UI: `DeployHistory` (one component, both rails)

Rendered under the `DeployButton` in `StudioRail` (mosaic) and `SoloRail`.
Reads only from the hook.

Each row, newest first, monospace:

```
#7  11:41  solo   fade 1.5 · dwell 14 · offset 4        [glass] [studio]
#6  11:30  solo   activeVersion solo                     
#5  10:02  v4     gate 0.55 · +2
```

- **Summary** is what changed **against the previous deploy**: up to three
  `key value` pairs, then `+n`. Computed client-side from consecutive
  snapshots with `diffKeys` per namespace; a namespace that appears or
  disappears is listed as `v4 reset`. Deploy #1 shows `first recorded`.
- **`glass` badge** on the row whose snapshot equals the live profile
  (deviation-equality per namespace, not "the newest id": a failed record
  would otherwise mislabel). **`studio` badge** on the row equal to the
  current studio profile.
- **Label** is inline-editable on click (text input, Enter saves, Esc
  cancels, 60 chars max). Shown after the number when set.
- **Click the row body → load into studio.** Same weight as "discard
  changes" today (no hold): the only thing lost is undeployed studio edits,
  which is exactly what revert already discards without ceremony. After
  load, the row shows the `studio` badge and Deploy arms if it differs from
  live. If keys were dropped, one line under the row: `loaded, 9 of 11 keys
  fit the current schema`.
- 50 rows max, scrolling inside the rail.
- When the last deploy of this session came back with `deploy: null`, one
  line above the list: `history not recorded (table missing?)`.

Status strip (both studios) is unchanged except the revert label rename.

## 3. Part B — solo preview on studio dials

### 3.1 What changes on `/studio/solo`

Today the panel is an `<img>` of the server's current frame with the live
overlays and a live countdown, captioned "as deployed". It becomes:

- The real `SoloFrame` component, fed by a **local play loop** on the
  **studio** dials: studio dwell + offset clock, studio fade, studio
  overlays (place, scores, rank, tally).
- It plays through the projected queue column top to bottom, cycling. The
  row it is showing gets the orange outline the on-glass row has today; the
  server's on-glass row gets a small `glass` tag instead, so both facts stay
  visible without competing.
- The header countdown ("next frame in N s") runs on the studio clock.
- The live truth moves to the status strip, one item per feed:
  `glass ↑ Bourail · 12 s` — the frame on glass and the seconds to its next
  change, on the live clock.

Nothing the preview does touches the server: no advance POST, no tally
bump. The glass keeps advancing on its own.

### 3.2 `useSoloPreview(feed, order: EntryView[], dials: SoloDials)`

Pure client hook, sibling to `useSoloGlass` but with no fetches.

- State: `index` into `order`, `previous: EntryView | null`.
- A timer armed with `msUntilBoundary(now, feed, dials.dwellS, dials.offsetS)`;
  on fire, `previous = order[index]`, `index = (index + 1) % order.length`,
  re-arm. Re-armed whenever `dwellS`/`offsetS` change (same pattern as
  `useSoloGlass`).
- When `order` changes (dial move, 5 s poll): if the entry at `index` is
  still in the new order, keep following it (find it by `snapshotId`);
  otherwise reset to 0. This stops a poll from yanking the preview back to
  the top every five seconds.
- Returns `{ current, previous, index, boundaryMs }`.
- `previous` is set in the same state update as `current` (derived, not in a
  trailing effect), so the crossfade's underlay is right on its first frame.
  The glass renderer's trailing-effect version of this is a known nit,
  fixed in Part B by the same derivation (`app/components/solo/index.tsx`).

### 3.3 Ordering constraint

PR #134 (`feat/solo2-rhythm`) touches every file under `app/studio/solo/`.
Part B lands **after** #134 merges, in its own worktree
(`feat/solo-studio-preview`). Part A touches none of those files and
starts now (`feat/deploy-history`).

## 4. Error handling

- History write fails → Deploy still succeeds; response says
  `deploy: null`; rail shows "history not recorded".
- Load of a missing id → 404 → rail row shows `gone` and the list
  revalidates.
- Load with schema drift → keys dropped and counted in the response, never
  silently.
- Preview with an empty queue → panel shows "nothing eligible with these
  dials" (the projected queue is empty exactly when `project()` returns
  nothing).

## 5. Testing

- `deploys.test.ts`: record/list/load/relabel against the mocked `sql`
  (existing `store.test.ts` pattern), including the missing-table path
  returning `null`/`[]`, the wholesale replace (a studio namespace absent
  from the snapshot is deleted), and drift dropping.
- Route tests for the four endpoints: owner gate, 404s, 400 on bad label,
  deploy response carrying `deploy`.
- `useStudioSettings.test.tsx`: `loadDeploy` clears the overlay and
  replaces `studio`; `deploy()` revalidates `deploys`.
- `DeployHistory.test.tsx`: summary text against the previous deploy,
  badges from profile equality, inline relabel, load click, `history not
  recorded` line.
- `useSoloPreview.test.tsx` (Part B): fake timers; advances on the studio
  clock; follows an entry across an order change; resets when it vanishes;
  `previous` correct on the first render after a change.
- Migration: `migrate:status` lists it; dry-run output in the PR.

## 6. Out of scope

- One-click "redeploy #n" that skips the studio. Preview-first is the
  principle; two clicks is the cost.
- Per-namespace history or diffs between arbitrary pairs of deploys.
- Pruning old deploys. Fifty rows of JSONB a day is nothing.
- Recording who deployed. There is one owner.
- Snapshotting bins, scenes or frames. Deploys are dial values only;
  scenes (`kiosk_scenes`) already cover frames.
