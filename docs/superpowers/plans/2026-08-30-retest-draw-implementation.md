# Retest Draw (Phase 0 of quality-ceiling roadmap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** serve ~150 already-rated frames back to the operator blind, store the
re-ratings in a separate table, and compute the operator's test–retest ceiling
(quality self-Pearson, detection self-agreement) with a pre-registered
decision rule.

**Architecture:** a new `manual_label_retests` table receives retest labels so
the gold `manual_labels` rows are physically untouchable (the existing write
path is an `ON CONFLICT DO UPDATE` upsert that would otherwise overwrite
gold). Retest sample membership reuses `label_samples` with a new
`kind = 'retest'` column; the training-export quarantine is scoped to
`kind = 'draw'` so retest membership does not silently remove gold rows from
training. The queue UI gains a third toggle position.

**Tech Stack:** Next.js route handlers + Neon (`@/app/lib/db` tagged sql),
vitest, psycopg2 scripts in `ml/` reading `DATABASE_URL` from `.env.local`.

**Spec:** `docs/superpowers/plans/2026-08-30-quality-ceiling-and-labeling-roadmap.md`
(Phase 0 section — draw shape, blind requirement, decision rules).

## Global Constraints

- Branch: `feat/retest-draw` off current `main`; verify
  `git rev-parse --abbrev-ref HEAD` before every commit; stage explicit paths
  only, never `git add -A` (shared checkout).
- Retest labels must NEVER be able to reach `manual_labels` or any training
  export — enforced by table separation, not by convention.
- Blind: no original rating, no judge scores, no disagreement text in any
  retest-mode response.
- Origin stamping binds to the fetched record/sample, not client UI state
  (the 2026-08-29 mislabeling bug class): the server validates sample
  membership before accepting a retest write.
- Migrations are forward-only and idempotent
  (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), applied with
  `psql "$DATABASE_URL" -f <file>` (DATABASE_URL from `.env.local`).
- Draw shape (from the spec): quality arm 15 per rating 1–5 (redistribute to
  adjacent buckets if short), detection arm 40 N + 35 rating-1; webcam frames
  only; frame must have a non-null `firebase_url`; prefer originals labeled
  ≥ 14 days ago inside each bucket, fill with newer only when a bucket is
  short; seed 20260830.
- Decision rule (pre-registered, restated from the spec): gap =
  self-Pearson − 0.697; ≤ 0.10 → ceiling reached, failure-mode track;
  > 0.10 → Phase 1 justified.

---

### Task 1: Migration — `manual_label_retests` + `label_samples.kind`

**Files:**
- Create: `database/migrations/20260830_manual_label_retests.sql`

**Interfaces:**
- Produces: table `manual_label_retests(source, image_id, is_sunset, rating,
  origin, labeled_at, UNIQUE (source, image_id, origin))`; column
  `label_samples.kind TEXT NOT NULL DEFAULT 'draw'` with
  `CHECK (kind IN ('draw','retest'))`.

- [ ] **Step 1: Write the migration**

```sql
-- Retest labels: the operator re-rating frames they already rated, to measure
-- test–retest reliability (the ceiling for any model). A separate table, NOT
-- rows in manual_labels: that table is UNIQUE (source, image_id) and its
-- write path is ON CONFLICT DO UPDATE, so a retest through it would OVERWRITE
-- the gold label. Physical separation also keeps retests out of every
-- training export by construction — export_dataset.py reads manual_labels.
--   psql "$DATABASE_URL" -f database/migrations/20260830_manual_label_retests.sql

CREATE TABLE IF NOT EXISTS manual_label_retests (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id    BIGINT NOT NULL,
  is_sunset   BOOLEAN NOT NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  origin      TEXT NOT NULL,          -- retest sample name, e.g. 'retest_v1'
  labeled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, image_id, origin)   -- one re-rating per frame per campaign
);

-- 'draw' = a normal eval draw (quarantined from training);
-- 'retest' = already-labeled frames served back blind (their ORIGINAL labels
-- must stay IN training — the export guard is scoped to kind = 'draw').
ALTER TABLE label_samples
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'draw'
  CHECK (kind IN ('draw', 'retest'));
```

- [ ] **Step 2: Apply and verify**

Run (annotation first, command second):
verify both objects exist; second query returns `kind`
```bash
psql "$DATABASE_URL" -f database/migrations/20260830_manual_label_retests.sql
psql "$DATABASE_URL" -c "\d manual_label_retests" \
  && psql "$DATABASE_URL" -c "SELECT DISTINCT kind FROM label_samples"
```
Expected: table described; single row `draw`.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260830_manual_label_retests.sql
git commit -m "feat(labels): manual_label_retests table + label_samples.kind"
```

### Task 2: Scope the export quarantine to `kind = 'draw'`

Must land BEFORE any retest rows are loaded: today's guard excludes ANY
`label_samples` member from training, so loading `retest_v1` naively would
silently drop up to 150 gold rows from the gold legs and their LLM rows from
the pretrain leg.

**Files:**
- Modify: `ml/export_dataset.py` — all three `NOT EXISTS (SELECT 1 FROM
  label_samples ls ...)` guards (≈ lines 309, 394, 411).

**Interfaces:**
- Consumes: `label_samples.kind` from Task 1.
- Produces: unchanged export CLI; guards now read
  `AND NOT EXISTS (SELECT 1 FROM label_samples ls WHERE ... AND ls.kind = 'draw')`.

- [ ] **Step 1: Record the baseline row counts**

Run the export dry-run / count path the repo already uses and save the
per-leg row counts printed (gold webcam, gold flickr, llm_only). These are
the regression oracle.

- [ ] **Step 2: Add `AND ls.kind = 'draw'` inside each of the three NOT EXISTS subqueries**

One-line change per site; keep the surrounding comment and extend it:
"scoped to kind='draw' — retest samples re-serve frames whose ORIGINAL labels
are training data and must stay in."

- [ ] **Step 3: Re-run the count path; expect byte-identical row counts**

All existing rows default to `kind = 'draw'`, so counts must not move. Any
drift = bug, stop.

- [ ] **Step 4: Commit**

```bash
git add ml/export_dataset.py
git commit -m "fix(export): scope label_samples quarantine to kind='draw'"
```

### Task 3: Stratified retest loader — `ml/load_retest_sample.py`

**Files:**
- Create: `ml/load_retest_sample.py` (mirror the structure/CLI conventions of
  `ml/load_label_sample.py`, including `load_env_local()` copied verbatim).

**Interfaces:**
- Produces: rows in `label_samples` with `kind = 'retest'`,
  `sample_name = args.sample_name`, shuffled `position` 1..N.
- CLI: `--sample-name retest_v1 --seed 20260830 --dry-run`.

- [ ] **Step 1: Write the draw**

Buckets, all `source = 'webcam'`, all requiring
`s.firebase_url IS NOT NULL` via `JOIN webcam_snapshots s ON s.id = m.image_id`:

```python
QUALITY_PER_RATING = 15          # ratings 1..5
DETECTION_N = 40                 # is_sunset = false
DETECTION_R1 = 35                # rating = 1 (drawn separately from quality arm)
STALE_DAYS = 14                  # prefer originals labeled >= 14 days ago

def draw_bucket(cur, where_sql, params, want, rng):
    cur.execute(f"""
        SELECT m.image_id, (m.labeled_at < now() - %s * interval '1 day') AS stale
        FROM manual_labels m
        JOIN webcam_snapshots s ON s.id = m.image_id
        WHERE m.source = 'webcam' AND s.firebase_url IS NOT NULL AND {where_sql}
    """, (STALE_DAYS, *params))
    rows = cur.fetchall()
    stale = [r[0] for r in rows if r[1]]; fresh = [r[0] for r in rows if not r[1]]
    rng.shuffle(stale); rng.shuffle(fresh)
    return (stale + fresh)[:want]
```

Quality arm: loop `rating = 1..5` with `where_sql = "m.is_sunset AND m.rating = %s"`.
If a bucket returns fewer than 15, redistribute the shortfall to the nearest
ratings that have surplus (walk outward: 5→4→3...). Detection arm:
`"NOT m.is_sunset"` for 40, `"m.is_sunset AND m.rating = 1"` for 35 — dedupe
against the quality arm's rating-1 picks before topping up. Shuffle the
combined list with `random.Random(seed)` for `position`.

- [ ] **Step 2: Dry-run and eyeball**

```bash
.venv/bin/python ml/load_retest_sample.py --sample-name retest_v1 --dry-run
```
Expected: per-bucket counts summing to ~150, % stale reported, zero inserts.

- [ ] **Step 3: Load for real, verify in SQL**

should return 150 / 'retest' / positions 1..150 gapless
```bash
psql "$DATABASE_URL" -c "SELECT count(*), min(position), max(position) \
  FROM label_samples WHERE sample_name = 'retest_v1' AND kind = 'retest'"
```

- [ ] **Step 4: Re-run the Task 2 export count check** — counts still at
baseline (this is the guard actually earning its keep).

- [ ] **Step 5: Commit**

```bash
git add ml/load_retest_sample.py
git commit -m "feat(ml): stratified retest sample loader"
```

### Task 4: `upsertRetestLabel` + sample routing helper in `app/lib/manualLabels.ts`

**Files:**
- Modify: `app/lib/manualLabels.ts`
- Test: extend the existing manual-labels route tests (Task 5's file) — the
  lib is exercised through the route, matching current repo convention.

**Interfaces:**
- Produces:
  `upsertRetestLabel(opts: {source, imageId, isSunset, rating?, origin}) : Promise<SavedLabel | null>` —
  INSERT ... ON CONFLICT `(source, image_id, origin)` DO UPDATE into
  `manual_label_retests` (self-correction within a sitting is allowed; it
  never touches `manual_labels`).
  `resolveLabelDestination(origin, source, imageId) : Promise<'gold' | 'retest' | 'reject'>`.

- [ ] **Step 1: Implement**

```ts
export async function resolveLabelDestination(
  origin: string | null | undefined,
  source: LabelSource,
  imageId: number,
): Promise<'gold' | 'retest' | 'reject'> {
  if (!origin) return 'gold';
  const rows = (await sql`
    SELECT kind,
           bool_or(source = ${source} AND image_id = ${imageId}) AS member
    FROM label_samples WHERE sample_name = ${origin} GROUP BY kind
  `) as { kind: string; member: boolean }[];
  const row = rows[0];
  if (!row) return 'gold';                       // 'hard_example' etc. — not a sample name
  if (row.kind !== 'retest') return 'gold';      // eval draws keep today's path
  return row.member ? 'retest' : 'reject';       // retest write MUST bind to the sample
}
```

`upsertRetestLabel` mirrors `upsertManualLabel` verbatim except table name,
conflict target `(source, image_id, origin)`, and `origin` is required.

- [ ] **Step 2: Commit with Task 5** (single reviewable unit — the route is
the only caller).

### Task 5: Route retest writes in `POST /api/manual-labels`

**Files:**
- Modify: `app/api/manual-labels/route.ts`
- Test: the route's existing test file (follow its established `vi.mock`
  pattern for `@/app/lib/db` and owner auth).

**Interfaces:**
- Consumes: `resolveLabelDestination`, `upsertRetestLabel` (Task 4).
- Produces: unchanged response shape `{ saved: SavedLabel }`; new 400
  `{ error: 'not in retest sample' }` on 'reject'.

- [ ] **Step 1: Write the failing tests**

Three cases, mocking the `label_samples` lookup result:
```ts
it('routes a retest-sample label into manual_label_retests, not manual_labels', ...)
// mock resolve → kind 'retest', member true; assert the INSERT SQL string
// contains 'manual_label_retests' and NOT a bare 'manual_labels' insert
it('rejects a retest origin for a frame outside the sample (400)', ...)
it('leaves hard_example and draw-sample origins on the gold path', ...)
```

- [ ] **Step 2: Run to verify they fail** — `npm run test -- manual-labels`

- [ ] **Step 3: Implement**

After the existing origin-format validation:
```ts
const dest = await resolveLabelDestination(origin ?? null, source, imageId);
if (dest === 'reject') {
  return NextResponse.json({ error: 'not in retest sample' }, { status: 400 });
}
const saved = dest === 'retest'
  ? await upsertRetestLabel({ source, imageId, isSunset, rating, origin })
  : await upsertManualLabel({ source, imageId, isSunset, rating, origin });
```

- [ ] **Step 4: Run tests to green** — `npm run test -- manual-labels`

- [ ] **Step 5: Commit**

```bash
git add app/lib/manualLabels.ts app/api/manual-labels/route.ts <test file>
git commit -m "feat(labels): route retest-sample labels to manual_label_retests"
```

### Task 6: Retest mode in `GET /api/snapshots?mode=verification`

**Files:**
- Modify: `app/api/snapshots/route.ts` (sample branch, ≈ lines 204–380)
- Test: `app/api/snapshots/route.test.ts` (existing
  `mode=verification` describe block's mock pattern)

**Interfaces:**
- Consumes: `label_samples.kind`, `manual_label_retests`.
- Produces: same response shape; for a `kind='retest'` sample the drop-out
  filter and the `sample.labeled` progress counter read
  `manual_label_retests` (matched on `origin = sampleName`) instead of
  `manual_labels`, and the `NOT IN manual_labels` exclusion is dropped
  (every retest frame is in `manual_labels` by construction).

- [ ] **Step 1: Write the failing tests**

```ts
it('serves retest-sample frames even though they have manual_labels rows', ...)
it('drops a frame from the retest queue once manual_label_retests has it', ...)
it('reports retest progress from manual_label_retests', ...)
it('retest responses carry no original rating, is_sunset, judge or disagreement fields', ...)
// the last one is the blind guarantee — assert on Object.keys of a returned item
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

Fetch the kind once when `sampleName` is set:
```ts
const kindRows = sampleName
  ? ((await sql`SELECT kind FROM label_samples WHERE sample_name = ${sampleName} LIMIT 1`) as { kind: string }[])
  : [];
const isRetest = kindRows[0]?.kind === 'retest';
```
Branch `webcamFilter` (and its external twin, though retest_v1 is
webcam-only) on `isRetest`:
```ts
? sql`AND s.id IN (SELECT image_id FROM label_samples
                    WHERE sample_name = ${sampleName} AND source = 'webcam')
      AND s.id NOT IN (SELECT image_id FROM manual_label_retests
                        WHERE source = 'webcam' AND origin = ${sampleName})`
```
Progress block: count labeled from `manual_label_retests` when `isRetest`.
Do not add any new SELECT columns — blindness falls out of the existing
field list; the test pins it.

- [ ] **Step 4: Run tests to green** — `npm run test -- snapshots/route`

- [ ] **Step 5: Commit**

```bash
git add app/api/snapshots/route.ts app/api/snapshots/route.test.ts
git commit -m "feat(queue): serve retest samples with retest-table drop-out"
```

### Task 7: Third queue toggle in `HardExamplesQueue.tsx`

**Files:**
- Modify: `app/components/HardExamples/HardExamplesQueue.tsx`
- Test: `app/components/HardExamples/HardExamplesQueue.test.tsx`

**Interfaces:**
- Consumes: GET/POST behavior from Tasks 5–6.
- Produces: `RETEST_SAMPLE_NAME = 'retest_v1'` constant beside the existing
  `SAMPLE_NAME`; queue state union gains `'retest'`; when selected,
  `fetchOrigin = RETEST_SAMPLE_NAME` and the fetch appends
  `&sample=retest_v1` — reusing the exact origin-binding path the
  2026-08-29 fix installed (origin travels with the fetched frame, not UI
  state at save time).

- [ ] **Step 1: Failing test** — toggling to Retest fetches with
`sample=retest_v1` and saves labels with `origin: 'retest_v1'` (mirror the
existing sample-toggle test).

- [ ] **Step 2–4: Implement, green, then commit**

```bash
git add app/components/HardExamples/HardExamplesQueue.tsx \
        app/components/HardExamples/HardExamplesQueue.test.tsx
git commit -m "feat(queue): retest toggle"
```

### Task 8: Analysis — `ml/analyze_retest.py`

**Files:**
- Create: `ml/analyze_retest.py` (env loading as in Task 3)

**Interfaces:**
- CLI: `--sample-name retest_v1 --model-pearson 0.697 --gap-threshold 0.10`
- Output: stdout table + JSON report
  `ml/artifacts/reports/retest_v1_ceiling.json`.

- [ ] **Step 1: Implement**

Join originals to retests:
```sql
SELECT m.is_sunset AS o_sun, m.rating AS o_r, m.origin AS o_origin,
       m.labeled_at AS o_at,
       r.is_sunset AS t_sun, r.rating AS t_r, r.labeled_at AS t_at
FROM manual_label_retests r
JOIN manual_labels m ON m.source = r.source AND m.image_id = r.image_id
WHERE r.origin = %s
```
Compute (numpy only — no scipy dependency):
- detection: percent agreement, Cohen's kappa, and the F1 of the retest pass
  treated as predictions against the original pass;
- quality: Pearson (`np.corrcoef`) + MAE on rows where both passes say
  sunset and both have ratings, on the normalized (r−1)/4 scale to match
  model reporting; n reported alongside;
- 6×6 confusion matrix over {N,1..5};
- splits by original-label age (≥/< 14 days) and by `o_origin`;
- verdict line: `gap = self_pearson - model_pearson` →
  `CEILING REACHED (failure-mode track)` if `gap <= 0.10` with n≥40 quality
  pairs, `HEADROOM — Phase 1 justified` if `gap > 0.10`, `UNDERPOWERED —
  finish the sitting` if n < 40.

- [ ] **Step 2: Smoke on partial data** — runs cleanly at any completion
level (guard div-by-zero; print n everywhere).

- [ ] **Step 3: Commit**

```bash
git add ml/analyze_retest.py
git commit -m "feat(ml): retest ceiling analysis with pre-registered verdict"
```

### Task 9: Wrap-up

- [ ] `npm run test` full suite + `npm run lint` green.
- [ ] Update `2026-08-30-quality-ceiling-and-labeling-roadmap.md` Phase 0
  status → "built, awaiting operator sitting"; add the queue-toggle
  instructions ("Hard Examples → Retest, n / 150 progress").
- [ ] Update STATE doc "What's next" block: Phase 0 built, sitting pending.
- [ ] Push `feat/retest-draw`, open PR, return checkout to `main`, announce
  in the session channel (2b is queued for the checkout).

## Execution notes

- Tasks 1–3 are DB/ml-side and testable without the Next.js suite; Tasks 4–7
  are one review arc (write path, read path, UI) — do not ship 6/7 without 5,
  or the queue would serve retest frames whose labels overwrite gold.
- The operator sitting itself and the Task 8 verdict are NOT part of this
  branch's definition of done — the code is done when the queue shows
  `retest_v1 0/150` and the full suite is green.
