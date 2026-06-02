# Hard Example Mining + Private Labeling — Design

**Status:** Design (2026-06-02). Successor to `memory/project_manual_rating_for_custom_cams.md` — extends from custom-cam-only to ALL webcams and adds automated disagreement triage.

**Replaces:** N/A. New project.

**Out of scope:** Phase 2 winner-selection retention (third class of "keep forever" rows). Land that here when winner-selection ships.

---

## Why

Two facts converging:

1. The v4 binary classifier has knowable blind spots. We caught one tonight (`Taltson River Airstrip`, 2026-06-02) — an obvious dramatic sunset that the model verdicted "not a sunset" while regression gave it 3.21/5. Silhouette and high-contrast scenes are systematically mis-classified. v5 needs labeled hard examples to learn from.

2. The cleanup endpoint at `app/api/snapshots/cleanup/route.ts` deletes by age only, with no filter on rating or value. **It's currently unscheduled** (vercel.json has only `/api/cron/update-cameras`) so we haven't actually lost data — but a future operator could trigger it and delete 33,000+ snapshots including ones that humans have already rated. The bug is one POST call away from being a disaster.

This project addresses both at once: automate the triage of model disagreements into a queue of training-worthy examples, give the operator a private labeling surface, and gate any cleanup behind retention rules that respect both human verdicts and disagreement flags.

A secondary goal: cleanly separate **operator tools** (labeling, model analysis, debug) from the **public site** (map, popup, kiosk). Public-facing inputs are an attack surface — bot spam, ballot stuffing, just nuisance. Moving all labeling to the operator drawer eliminates that surface.

---

## Architecture

Three layers, each with a clear role:

```
                    SNAPSHOT CAPTURED
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌────────────┐         ┌────────────┐
       │ Binary head│         │ Regr. head │   ← AUTO (cron)
       └────┬───────┘         └────────┬───┘
            │                          │
            └────────┬─────────────────┘
                     │ Compare both outputs at write time
                     ▼
       ┌──────────────────────────────────┐
       │ model_disagreement_kind = ?      │   ← AUTO (cron)
       │   binary_negative_regression_high│      Triage signal.
       │   binary_positive_regression_low │      NOT a label.
       │   NULL  (agreement)              │
       └──────────────┬───────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │ Hard Examples drawer tab    │   ← Operator-only.
        │ (filter on disagreement_kind │     Reuses SnapshotConsole
        │  AND is_sunset_verdict NULL) │     batch-loading pattern.
        └──────────────┬──────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Operator clicks │   ← MANUAL (Jesse only).
              │ Yes / No on the │      THIS is the label.
              │ snapshot image  │      Stars gated on "Yes".
              └────────┬────────┘
                       │
                       ▼
       ┌────────────────────────────────────┐
       │ webcam_snapshot_ratings.           │   ← Gold-standard
       │   is_sunset_verdict = TRUE | FALSE │     training labels.
       │   rating = 1..5 (Yes only)         │
       └────────────────────────────────────┘
                       │
                       ▼
       ┌──────────────────────────────────┐
       │ webcam_snapshots.                 │   ← Denormalized for
       │   human_sunset_majority = bool    │     fast cron + cleanup
       │   calculated_rating = avg         │     read paths.
       └──────────────────────────────────┘
                       │
                       │ Survives the 7-day cleanup forever.
                       ▼
            v5 binary training dataset
```

---

## Schema changes

Three columns across two tables. Each has one purpose.

```sql
-- 1. webcam_snapshot_ratings — per-user verdict. Same (snapshot_id,
--    user_session_id) key as the existing star rating row. Nullable so
--    existing star-only rows still validate.
ALTER TABLE webcam_snapshot_ratings
  ADD COLUMN IF NOT EXISTS is_sunset_verdict BOOLEAN;

-- 2. webcam_snapshots — denormalized majority of all is_sunset_verdict
--    rows for a snapshot. Recomputed at submit-time by the same code path
--    that already maintains calculated_rating. Used by cron + cleanup so
--    those don't have to JOIN.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS human_sunset_majority BOOLEAN;

-- 3. webcam_snapshots — cron-written triage signal. NOT a label.
--    See "Cron writes" section for the populating rules.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS model_disagreement_kind TEXT;
  -- Allowed values:
  --   'binary_negative_regression_high'  — binary said no, regression said high; missed sunset
  --   'binary_positive_regression_low'   — binary said yes, regression said low; false positive
  --   NULL                                — agreement OR one head didn't score
```

**Index for fast queue reads:**

```sql
CREATE INDEX IF NOT EXISTS webcam_snapshots_disagreement_idx
  ON webcam_snapshots (captured_at DESC)
  WHERE model_disagreement_kind IS NOT NULL;
```

Partial index — only indexes the disagreement rows, which is a small fraction of total snapshots. Drives the "Hard Examples" tab's pagination.

---

## Cron writes

The disagreement flag is set by `app/api/cron/update-cameras/route.ts` at the moment both heads finish scoring the same snapshot. In TypeScript:

```typescript
// After scoreImage() returns both heads' values for a snapshot:
let disagreementKind: string | null = null;
if (typeof scored.binaryIsSunset === 'boolean' && scored.aiRating != null) {
  const binarySaysNo = !scored.binaryIsSunset;
  const binarySaysYes = scored.binaryIsSunset;
  const regressionHigh = scored.aiRating >= 3.0;   // 1-5 scale
  const regressionLow  = scored.aiRating <= 2.0;   // 1-5 scale
  if (binarySaysNo && regressionHigh) {
    disagreementKind = 'binary_negative_regression_high';
  } else if (binarySaysYes && regressionLow) {
    disagreementKind = 'binary_positive_regression_low';
  }
  // else: NULL (agreement, or values not extreme enough to flag)
}
// Write disagreementKind to webcam_snapshots.model_disagreement_kind alongside the existing AI fields.
```

**Tunable thresholds** (`SUNSET_DISAGREEMENT_HIGH = 3.0`, `SUNSET_DISAGREEMENT_LOW = 2.0`) live in `app/lib/masterConfig.ts`. The current pick errs toward fewer-but-clearer disagreements. Tighten (3.5 / 1.5) for a smaller queue, loosen (2.6 / 2.6) for more triage signal.

**Custom-camera path** (`backfillCustomSnapshotScores` in `customBackfill.ts`) writes `model_disagreement_kind` the same way — there's no path distinction.

---

## Cleanup gate + retention rules

### Add an explicit gate

`app/lib/masterConfig.ts`:

```typescript
// Hard kill-switch for the snapshot cleanup endpoint. Default OFF — the
// cleanup at /api/snapshots/cleanup deletes by age without distinguishing
// human-rated or model-disagreement snapshots from the rest. Flip to true
// only when you intentionally want to prune. Even when true, snapshots in
// these three classes survive:
//   1. Anyone ever rated or verdicted (webcam_snapshot_ratings has a row)
//   2. Cron flagged as model disagreement
//   3. (Future) Phase 2 winner-selection marked is_window_winner=true
//
// History: as of 2026-06-02 the cleanup endpoint is unscheduled and has
// no automated trigger. Flipping CLEANUP_ENABLED=true does NOT cause
// cleanup to start happening — you still have to POST to the endpoint
// yourself (or schedule it via vercel.json crons). This constant only
// ensures the endpoint refuses to delete anything when set to false.
export const CLEANUP_ENABLED = false;
```

### Endpoint behavior change

`app/api/snapshots/cleanup/route.ts`:

```typescript
import { CLEANUP_ENABLED } from '@/app/lib/masterConfig';

export async function GET(request: Request) {
  return cleanup(request);
}
export async function POST(request: Request) {
  return cleanup(request);
}

async function cleanup(request: Request) {
  // ... existing auth check ...

  if (!CLEANUP_ENABLED) {
    return NextResponse.json({
      ok: true,
      deleted: 0,
      skipped_reason: 'CLEANUP_ENABLED is false in masterConfig.ts. ' +
        'Flip to true if you intentionally want to prune.',
    });
  }

  const oldSnapshots = await sql`
    SELECT id, firebase_path, captured_at
    FROM webcam_snapshots
    WHERE captured_at < NOW() - INTERVAL '7 days'
      AND model_disagreement_kind IS NULL
      AND id NOT IN (
        SELECT DISTINCT snapshot_id FROM webcam_snapshot_ratings
        WHERE rating IS NOT NULL OR is_sunset_verdict IS NOT NULL
      )
    ORDER BY captured_at ASC
  `;

  // ... rest of existing delete loop ...
}
```

Three changes from current behavior:

1. **Refuses to run when `CLEANUP_ENABLED=false`** — returns ok:true with 0 deleted and an explanation, so any future cron schedule fails safe
2. **Excludes human-touched snapshots** from the delete list — anyone ever rated or verdicted it
3. **Excludes model-disagreement snapshots** from the delete list — pending triage / training value

### Documentation cleanup

Add to `ml/OPERATING_GUIDE.md` and to a new section atop `app/api/snapshots/cleanup/route.ts`:

> **DANGER — Cleanup endpoint state as of 2026-06-02.** This endpoint exists but is **not on any cron schedule**. It can only run when manually invoked. Even when invoked, it respects:
> - `CLEANUP_ENABLED` gate in `app/lib/masterConfig.ts` (default `false`)
> - Snapshots with `webcam_snapshot_ratings` rows survive
> - Snapshots with `model_disagreement_kind IS NOT NULL` survive
>
> Before enabling cron-scheduled cleanup, audit the retention rules above to make sure your training data won't get nuked.

---

## API changes

### Extend `POST /api/snapshots/[id]/rate`

The existing endpoint accepts `{userSessionId, rating}`. Grow it:

```typescript
type RateRequest = {
  userSessionId: string;
  rating?: number;          // 1-5 integer; required only when isSunsetVerdict is true
  isSunsetVerdict?: boolean; // new; the binary verdict
};
```

Validation rules:

- `isSunsetVerdict === true` → `rating` required (1-5 integer)
- `isSunsetVerdict === false` → `rating` MUST be absent or null (can't rate non-sunsets)
- `isSunsetVerdict` not provided → falls back to today's behavior (star-only — kept for back-compat with custom Pi cam UI)
- Either `rating` or `isSunsetVerdict` required — empty body is a 400

UPSERT writes to `webcam_snapshot_ratings (snapshot_id, user_session_id, rating, is_sunset_verdict)`. Then the recompute step writes both denormalized columns on `webcam_snapshots`:

- `calculated_rating = AVG(rating) FROM webcam_snapshot_ratings WHERE snapshot_id = $1`
- `human_sunset_majority = (COUNT yes) > (COUNT no) FROM webcam_snapshot_ratings WHERE snapshot_id = $1 AND is_sunset_verdict IS NOT NULL`

### DELETE endpoint

Unchanged in shape — it already deletes the user's whole row, which now includes the verdict.

---

## UI changes

### Remove the public popup labeling surface

`app/components/Webcam/RatingCard.tsx` currently mounts the `StarRating` widget and accepts an `onRate` callback. The popup version (rendered via `useSetWebcamMarkers.tsx`'s `createRoot`) gets a **read-only treatment**:

- Keep `<AiRatingDisplay>` (the verdict + stars + footer)
- Remove `<StarRating>`
- Remove `onRate` prop usage; mark as no-op when present
- Remove "Rate this sunrise/sunset" header

**Preserve the rating UI elsewhere.** `RatingCard` is also imported by `WebcamConsole.tsx` and `SnapshotQueueCard.tsx`. Both render inside the operator drawer and ALL operator surfaces keep the full rating UX. The split is:

- Map popup (public-facing) → **read-only**
- Drawer tabs (operator-only) → **full rating + verdict UX**

To make this split clean, `RatingCard` grows a `readOnly?: boolean` prop. Map popup mounts it with `readOnly={true}`; drawer surfaces don't pass the prop (default false). Star widget + verdict buttons hide when `readOnly`.

### Add a "Hard Examples" tab to the drawer

`app/HomeClient.tsx` currently has 6 tabs:

```
[Current Sunrises/Sunsets] [Snapshot Archive] [Curated] [Unrated Queue] [All Webcams] [Model Analysis]
```

Insert "⚠ Hard Examples" at index 1 (between "Current" and "Snapshot Archive"). Renders the existing `SnapshotConsole` with `mode="hard-examples"`. After the insert:

```
[Current Sunrises/Sunsets] [⚠ Hard Examples] [Snapshot Archive] [Curated] [Unrated Queue] [All Webcams] [Model Analysis]
```

### `SnapshotConsole` gains `mode="hard-examples"`

The component already supports `mode: "archive" | "curated" | "unrated"`. Add `"hard-examples"`. Backend filter:

```sql
SELECT s.* FROM webcam_snapshots s
WHERE s.model_disagreement_kind IS NOT NULL
  AND s.id NOT IN (
    SELECT snapshot_id FROM webcam_snapshot_ratings
    WHERE user_session_id = $current_session AND is_sunset_verdict IS NOT NULL
  )
ORDER BY s.captured_at DESC
LIMIT $batch_size OFFSET $offset;
```

Filter logic: "show me snapshots the cron flagged for triage AND I haven't verdicted yet." Once I verdict it, it leaves my queue.

### Add Yes/No verdict buttons to the labeling card

Shared between "Hard Examples" and "Unrated Queue" tabs — wherever `SnapshotConsole` renders an individual card. Layout above the existing stars:

```
┌──────────────────────────────┐
│        [snapshot image]      │
├──────────────────────────────┤
│  Is this a sunrise?          │ ← phase-aware
│  [  Yes  ]   [  No  ]        │
├──────────────────────────────┤
│  Rate this sunrise           │ ← gated: only enabled on "Yes"
│  ★ ★ ★ ★ ★                   │
└──────────────────────────────┘
```

Behavior:

- No verdict yet → both buttons un-selected, stars disabled (greyed)
- "Yes" clicked → button highlights, stars become interactive; can submit star rating which posts `{isSunsetVerdict: true, rating: N}`
- "No" clicked → button highlights, stars hide entirely; posts `{isSunsetVerdict: false}` immediately
- Re-clicking the already-selected button un-selects (lets you change your mind before submitting)

The "No" path submits immediately because there's nothing else to enter. The "Yes" path submits when star is clicked. The keyboard hotkeys that already exist in `SnapshotConsole` extend: `y`/`n` for verdict, `1`-`5` for rating (only when verdict is yes).

### Keep custom Pi camera star rating

Custom Pi cam snapshots are already rated via `RatingCard` in the drawer (not the map popup). That path stays unchanged — the operator can star-rate them as today. Adding the verdict UI to `RatingCard` benefits this path too: you can mark a Pi cam snapshot as "yes/no sunset" and rate it.

---

## Files affected

**Modify:**

- `app/lib/masterConfig.ts` — add `CLEANUP_ENABLED`, `SUNSET_DISAGREEMENT_HIGH`, `SUNSET_DISAGREEMENT_LOW`
- `app/api/snapshots/cleanup/route.ts` — gate + retention exclusions + danger comment
- `app/api/snapshots/[id]/rate/route.ts` — accept `isSunsetVerdict`, update validation, recompute majority column
- `app/api/cron/update-cameras/route.ts` — compute and write `model_disagreement_kind`
- `app/api/cron/update-cameras/lib/customBackfill.ts` — same for custom path
- `app/api/cron/update-cameras/lib/dbOperations.ts` — extend `updateSnapshotAiRegressionScore` signature with disagreement kind
- `app/components/Webcam/RatingCard.tsx` — add `readOnly?: boolean` prop; hide rating widgets when set
- `app/components/Map/hooks/useSetWebcamMarkers.tsx` — pass `readOnly={true}` to RatingCard
- `app/components/SnapshotConsole.tsx` — add `mode="hard-examples"`; verdict buttons
- `app/components/SnapshotQueueCard.tsx` — verdict buttons (shared between modes)
- `app/HomeClient.tsx` — insert "Hard Examples" tab at index 1
- `ml/OPERATING_GUIDE.md` — document the retention story
- `app/components/Webcam/AiRatingDisplay.tsx` — unchanged; the popup-side display work is already done

**Create:**

- `database/migrations/20260602_hard_example_mining.sql` — three column adds + partial index
- `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md` — this doc
- `docs/superpowers/plans/2026-06-02-hard-example-mining-and-private-labeling.md` — implementation plan (next step)

---

## Tests

**New:**

- `app/api/snapshots/[id]/rate/route.test.ts` (or extension) — verdict-only submit, verdict+rating submit, invalid no-verdict-but-rating, majority recompute
- `app/api/snapshots/cleanup/route.test.ts` — gate respected, human-rated rows excluded, disagreement rows excluded
- `app/api/cron/update-cameras/lib/aiScoring.test.ts` — extend with disagreement-kind branches (already tests the dual-head outputs)
- `app/components/SnapshotConsole.test.tsx` (or new) — hard-examples mode filter, verdict-button rendering, stars-gating behavior

**Verify:**

- After deploy: run the SQL queue query against Neon, confirm row count matches the Hard Examples tab
- Manual: rate a snapshot via "No," then via "Yes" + 4 stars; confirm both flows persist and the cleanup endpoint refuses to delete either

---

## Open questions (defer to follow-up)

- **Phase 2 winner-selection retention** — when winner-selection ships, extend the cleanup exclusion list with `is_window_winner = true`. Not in this scope.
- **Multi-rater majority semantics** — if multiple operators ever label disagreements, do we want simple majority or weighted (with rater confidence)? Today the only operator is Jesse so this is moot.
- **Hard-example dataset export** — `ml/export_dataset.py` will eventually need a flag to mix hard examples into the v5 training set. Not in this scope; we ship label collection first, dataset extraction lands when training v5.
- **Operator auth** — every labeling endpoint today is anonymous via `userSessionId`. Eventually we'll want real auth so we can de-dupe by person. Not in this scope.

---

## Migration order

Forward-only, idempotent. Apply on prod Neon BEFORE deploying the code changes:

```bash
psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql
```

Old code is forward-compatible because the new columns are all nullable (verdict, majority, disagreement kind). Old code keeps working as if the columns don't exist.
