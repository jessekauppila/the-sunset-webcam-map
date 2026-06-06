# Remove Metadata-Heuristic Scoring Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ONNX the only thing that can produce a sunset score — when it can't run, return honest `NULL` instead of a fabricated view-count guess — and clean the fake scores already in the database.

**Architecture:** `scoreImage` loses its `baseline`/`baseline-fallback` heuristic and the `AI_SCORING_MODE` knob; on any ONNX failure it returns `pathTaken: 'unscored'` with `null` scores. All three score-writers (`route.ts` Windy cron, `customBackfill.ts`, the read-only smoke endpoint) skip the write on `'unscored'`, leaving columns `NULL` so the existing `WHERE ai_regression_score IS NULL` finders reclaim the row once the model loads. A one-time migration nulls existing baseline junk.

**Tech Stack:** TypeScript, Next.js API routes, Vitest, Postgres (Neon), onnxruntime-node.

**Branch:** `fix/remove-baseline-fallback` (off `main`). Spec: `docs/superpowers/specs/2026-06-06-remove-metadata-heuristic-fallback-design.md`.

**Canonical contract (used by every task — keep consistent):**
- `ScorePath = 'onnx' | 'cache-hit' | 'unscored'`
- `ScoreImageResult.rawScore: number | null`, `ScoreImageResult.aiRating: number | null` (both `null` iff `pathTaken === 'unscored'`)
- `ScoreImageInput` no longer has `fallbackMeta`
- `scoreBinary` returns `undefined` on failure (no `binaryPathTaken: 'baseline-fallback'`)
- Consumer guard (narrows both fields to `number`): `if (scored.rawScore === null || scored.aiRating === null) { /* unscored */ }`

---

## Task 1: `scoreImage` returns honest `'unscored'`; delete the heuristic + mode branch

**Files:**
- Modify: `app/api/cron/update-cameras/lib/aiScoring.ts`
- Test: `app/api/cron/update-cameras/lib/aiScoring.test.ts`

- [ ] **Step 1: Rewrite the affected tests to assert the `'unscored'` contract (failing)**

In `aiScoring.test.ts`, **remove** `process.env.AI_SCORING_MODE = 'onnx';` from the `beforeEach` (line 36).

**Replace** the test `'falls back to baseline when ONNX inference throws'` (lines 105–118) with:

```ts
  it('returns "unscored" with null scores when ONNX inference throws', async () => {
    runMock.mockRejectedValueOnce(new Error('boom'));
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.pathTaken).toBe('unscored');
    expect(result.rawScore).toBeNull();
    expect(result.aiRating).toBeNull();
    expect(result.modelVersion).toBe('test-v4');
    expect(result.imageHash).toBe('hash-abc');
  });

  it('returns "unscored" when ONNX setup (preprocess) throws', async () => {
    preprocessMock.mockRejectedValueOnce(new Error('no model'));
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.pathTaken).toBe('unscored');
    expect(result.rawScore).toBeNull();
    expect(result.aiRating).toBeNull();
  });
```

**Delete** the test `'returns pathTaken=baseline when AI_SCORING_MODE is not onnx'` (lines 129–144) entirely — the mode no longer exists.

**Replace** the binary-failure test `'leaves regression intact when only the binary head throws'` (lines 226–241) body's last two assertions:

```ts
      expect(result.pathTaken).toBe('onnx');
      expect(result.aiRating).toBeCloseTo(3.56, 2);
      expect(result.binaryPathTaken).toBeUndefined();
      expect(result.binaryRawScore).toBeUndefined();
      expect(result.binaryIsSunset).toBeUndefined();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts`
Expected: FAIL — current code returns `'baseline-fallback'`/`'baseline'` and a numeric `rawScore`, and `fallbackMeta` is gone from the type.

- [ ] **Step 3: Implement — delete the heuristic, return `'unscored'`**

In `aiScoring.ts`:

1. Update the top doc comment (lines 18–21) — replace the "falls back to the metadata-only baseline so the cron never crashes" sentence with:

```ts
 * A SHA-256 of the bytes lets callers short-circuit re-scoring identical
 * frames (Redis-backed at call site). On any ONNX failure (setup or the
 * regression head), returns pathTaken:'unscored' with null scores — callers
 * must NOT write a score for these. Binary failures degrade silently (binary
 * fields left undefined). There is no metadata fallback: the model is the only
 * thing that may produce a score.
```

2. Remove `AI_SCORING_MODE_DEFAULT,` from the masterConfig import (line 31).

3. Change the `fallbackMeta` field off `ScoreImageInput` — delete lines 46–47:

```ts
  /** From Redis. When equal to the new hash, returns cache-hit without scoring. */
  lastImageHash?: string;
}
```

4. Narrow the path types:

```ts
export type ScorePath = 'onnx' | 'cache-hit' | 'unscored';
```

5. Make the regression fields nullable in `ScoreImageResult` (lines 53–59):

```ts
  // Regression (number when pathTaken==='onnx'; null when 'unscored';
  // 0 is an ignored placeholder on 'cache-hit').
  rawScore: number | null;   // 0..1 (normalized; matches training label scale)
  aiRating: number | null;   // 1..5 (display)
  modelVersion: string;
  imageHash: string;
  source: WebcamSource;
  pathTaken: ScorePath;
```

And update the `binaryPathTaken` comment (line 66) to `// 'onnx'`.

6. **Delete** `baselineRaw` (lines 160–166) and `ratingFromRaw` (lines 168–172) — both are now unused.

7. Add an `unscored` helper just above `scoreImage`:

```ts
function unscored(
  input: ScoreImageInput,
  imageHash: string,
  modelVersion: string,
): ScoreImageResult {
  return {
    rawScore: null,
    aiRating: null,
    modelVersion,
    imageHash,
    source: input.source,
    pathTaken: 'unscored',
  };
}
```

8. In `scoreBinary` (lines 338–349), replace the catch's returned object with `undefined`:

```ts
  } catch (error) {
    console.warn(
      `[scoreImage] binary ONNX failed for webcam ${webcamId}, leaving binary fields unset:`,
      error,
    );
    return undefined;
  }
```

And update its return type `pathTaken: ScorePath;` → `pathTaken: 'onnx';` (line 324).

9. Rewrite the body of `scoreImage` from the mode block onward (replace lines 374–447):

```ts
  // ONNX is the only real scorer. If it can't run, return 'unscored' (null
  // scores) — never a fabricated number.
  let ort: unknown;
  let tensorData: Float32Array;
  try {
    ort = await getOrt();
    tensorData = await preprocessJpegToImagenetTensor(input.imageBytes);
  } catch (error) {
    console.error(
      `[scoreImage] ONNX setup failed for webcam ${input.webcamId}, leaving unscored:`,
      error,
    );
    return unscored(input, imageHash, modelVersion);
  }

  // Regression head — required. Failure means unscored.
  let regression: { rawScore: number; aiRating: number };
  try {
    const data = await runOnnxSession(ort, resolveRegressionModelPath(), tensorData);
    const value = Number(data[0] ?? 0.5);
    regression = normalizeRegressionOutput(value);
  } catch (error) {
    console.error(
      `[scoreImage] regression ONNX failed for webcam ${input.webcamId}, leaving unscored:`,
      error,
    );
    return unscored(input, imageHash, modelVersion);
  }

  // Binary head — optional. Don't fail the result if it errors.
  const binary = await scoreBinary(ort, input.webcamId, tensorData);

  return {
    rawScore: regression.rawScore,
    aiRating: regression.aiRating,
    modelVersion,
    imageHash,
    source: input.source,
    pathTaken: 'onnx',
    binaryRawScore: binary?.rawScore,
    binaryIsSunset: binary?.isSunset,
    binaryModelVersion: binary?.modelVersion,
    binaryPathTaken: binary?.pathTaken,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts`
Expected: PASS (all `scoreImage`, `softmaxBinaryClassOne`, `computeDisagreementKind` tests green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors in `aiScoring.ts`. (Consumer files `route.ts` / `customBackfill.ts` / `scoring-smoke` may now error on `rawScore` being `number | null` — that is expected and fixed in Tasks 3–5. If you want a clean checkpoint, you can defer this command until after Task 5.)

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/aiScoring.ts app/api/cron/update-cameras/lib/aiScoring.test.ts
git commit -m "feat(scoring): scoreImage returns 'unscored' on ONNX failure, delete baseline heuristic"
```

---

## Task 2: Delete the `AI_SCORING_MODE_DEFAULT` footgun

**Files:**
- Modify: `app/lib/masterConfig.ts`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "AI_SCORING_MODE" app/ --include="*.ts" --include="*.tsx"`
Expected: only the definition line in `masterConfig.ts` (Task 1 removed the `aiScoring.ts` import + usage). If any other reference appears, stop and reconcile.

- [ ] **Step 2: Remove the export**

In `app/lib/masterConfig.ts`, delete the line:

```ts
export const AI_SCORING_MODE_DEFAULT = 'baseline';
```

(plus any immediately-preceding comment that only documents it).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to `masterConfig.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/lib/masterConfig.ts
git commit -m "refactor(scoring): remove AI_SCORING_MODE_DEFAULT — missing env var can no longer fake scores"
```

---

## Task 3: Live Windy cron skips the write on `'unscored'`

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts:136-145,174-181,255-264` (and the comment at 137–139)
- Test: `app/api/cron/update-cameras/route.test.ts`

- [ ] **Step 1: Update + add tests (failing)**

In `route.test.ts`, find the test `'returns a scoringPaths breakdown counted from scored.pathTaken'` (line 262). Change the third mock (line 276) and the expected object (lines 279–284):

```ts
      .mockResolvedValueOnce({ rawScore: 0.6, aiRating: 3.4, modelVersion: 'v4', imageHash: 'h1', source: 'windy', pathTaken: 'onnx' })
      .mockResolvedValueOnce({ rawScore: 0, aiRating: 0, modelVersion: 'v4', imageHash: 'h2', source: 'windy', pathTaken: 'cache-hit' })
      .mockResolvedValueOnce({ rawScore: null, aiRating: null, modelVersion: 'v4', imageHash: 'h3', source: 'windy', pathTaken: 'unscored' });
```

```ts
    expect(body.scoringPaths).toEqual({
      onnx: 1,
      'cache-hit': 1,
      unscored: 1,
    });
```

Add a new test directly after it (mirror the existing mock setup in this file — `scoreMock`, `updateAiFieldsMock`, three webcams from `windyApi` mock):

```ts
  it('does NOT write AI fields for an unscored webcam (leaves columns null)', async () => {
    scoreMock.mockReset().mockResolvedValue({
      rawScore: null, aiRating: null, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'unscored',
    });
    updateAiFieldsMock.mockClear();

    const res = await GET(makeReq());
    const body = await res.json();

    expect(updateAiFieldsMock).not.toHaveBeenCalled();
    expect(body.scoringPaths.unscored).toBeGreaterThan(0);
    expect(body.scoringPaths.onnx).toBe(0);
  });
```

> Note: use the same request/`GET` invocation helper the surrounding tests use in this file (e.g. the existing `makeReq()` / `GET(...)` pattern visible in the other `it(...)` blocks). If the helper has a different name, match it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: FAIL — current code increments `'baseline-fallback'`/`'baseline'` buckets and writes AI fields for every non-cache-hit path.

- [ ] **Step 3: Implement the skip-on-unscored path**

In `route.ts`:

1. Update the comment + `scoringPaths` declaration (lines 137–145):

```ts
  // Per-tick breakdown of which scoring path each webcam took. Makes
  // 'is ONNX actually running' inspectable from the cron response —
  // scoringPaths.onnx > 0 && scoringPaths.unscored === 0 is green.
  const scoringPaths: Record<'onnx' | 'cache-hit' | 'unscored', number> = {
    onnx: 0,
    'cache-hit': 0,
    unscored: 0,
  };
```

2. Replace the path-handling block (lines 174–181):

```ts
      if (scored.pathTaken === 'cache-hit') {
        cacheHits += 1;
        scoringPaths['cache-hit'] += 1;
        return;
      }
      if (scored.rawScore === null || scored.aiRating === null) {
        // 'unscored' — ONNX produced no real score. Write nothing; leave the
        // columns NULL so the backfill (WHERE ai_regression_score IS NULL)
        // reclaims this row once the model is loading again. Never fabricate.
        fallbacks += 1;
        scoringPaths.unscored += 1;
        return;
      }
      scoringPaths.onnx += 1;
      windyScores.push(scored.rawScore);
```

3. In the `catch` block (lines 260–263), change the bucket name:

```ts
      fallbacks += 1;
      // Same conflation as `fallbacks`: download/timeout failures count as a
      // non-scored path since no real score was produced.
      scoringPaths.unscored += 1;
```

(Everything between — `updateWebcamAiFields`, the `binaryRating` math, `computeDisagreementKind`, the snapshot persist — now only runs for genuine `'onnx'` rows, and `scored.rawScore` / `scored.aiRating` are narrowed to `number` by the guard above.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(cron): Windy scoring writes nothing on 'unscored', rename telemetry bucket"
```

---

## Task 4: `customBackfill` skips the write on `'unscored'`

**Files:**
- Modify: `app/api/cron/update-cameras/lib/customBackfill.ts:37-67`
- Test: `app/api/cron/update-cameras/lib/customBackfill.test.ts`

- [ ] **Step 1: Add a failing test**

In `customBackfill.test.ts`, add (mirroring the file's existing `scoreMock` / `updateSnapMock` / `findMock` setup):

```ts
  it('does NOT write a score for an unscored snapshot and does not sync the webcam', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 7, firebaseUrl: 'https://x/img.jpg' },
    ]);
    scoreMock.mockResolvedValue({
      rawScore: null, aiRating: null, modelVersion: 'v4',
      imageHash: 'h', source: 'custom', pathTaken: 'unscored',
    });

    const result = await backfillCustomSnapshotScores({ limit: 10 });

    expect(updateSnapMock).not.toHaveBeenCalled();
    expect(syncWebcamMock).not.toHaveBeenCalled();
    expect(result.scored).toBe(0);
    expect(result.scores).toEqual([]);
  });
```

> Use the mock variable names already defined at the top of this test file for `findCustomSnapshotsNeedingScore`, `updateSnapshotAiRegressionScore`, and `updateWebcamRegressionScoreFromLatestCustomSnapshot`. (Above they are referenced as `findMock`, `updateSnapMock`, `syncWebcamMock` — match the file's actual names.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/customBackfill.test.ts`
Expected: FAIL — current code calls `updateSnapshotAiRegressionScore` with `result.rawScore` regardless of path.

- [ ] **Step 3: Implement the guard**

In `customBackfill.ts`, inside the `for` loop, immediately after the `scoreImage` call (after line 44) and before `computeDisagreementKind`:

```ts
      if (result.rawScore === null || result.aiRating === null) {
        // 'unscored' — ONNX produced no real score. Skip the write entirely so
        // we don't fabricate, and don't sync the parent webcam from a non-score.
        // The finder (WHERE ai_regression_score IS NULL) re-queues this row.
        failed += 1;
        continue;
      }
```

(The existing `scores.push(result.rawScore)` and `touchedWebcamIds.add(...)` below now only run for real scores, so the per-webcam sync loop never fires from an unscored row.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/lib/customBackfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/customBackfill.ts app/api/cron/update-cameras/lib/customBackfill.test.ts
git commit -m "feat(scoring): customBackfill writes nothing on 'unscored' (second fake-score leak)"
```

---

## Task 5: Smoke endpoint tolerates `null` + full typecheck/test sweep

**Files:**
- Verify: `app/api/debug/scoring-smoke/route.ts` (no code change expected — `NextResponse.json` serializes `null` fine; `rawScore`/`aiRating` already returned)

- [ ] **Step 1: Confirm the smoke endpoint compiles with nullable fields**

Run: `npx tsc --noEmit`
Expected: PASS across the whole project. The smoke route already passes `result.rawScore` / `result.aiRating` straight into `NextResponse.json`, which accepts `null`. If `tsc` flags it, the fix is only to allow `null` in any explicit response type — do not add a fallback value.

- [ ] **Step 2: Full test sweep for the touched modules**

Run: `npx vitest run app/api/cron/update-cameras app/api/debug`
Expected: PASS. (Pre-existing unrelated `app/components/Map/` failures, if any, are out of scope — do not fix them here.)

- [ ] **Step 3: Commit (only if a change was needed)**

```bash
git add app/api/debug/scoring-smoke/route.ts
git commit -m "chore(scoring): smoke endpoint tolerates null rawScore from 'unscored'"
```

If no change was needed, skip this commit.

---

## Task 6: Cleanup migration — null the existing baseline junk

**Files:**
- Create: `database/migrations/20260606_null_baseline_scores.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Null the AI-produced scores that the metadata heuristic fabricated, so the
-- leaderboard stops ranking guesses and the ONNX backfill reclaims these rows
-- (finder = WHERE ai_regression_score IS NULL). Forward-only, idempotent.
--
-- SCOPE BOUNDARY: touches ONLY ai_* / scoring_path / model_disagreement_kind.
-- It NEVER touches human-rating columns — webcams.rating, initial_rating, or
-- any column of webcam_snapshot_ratings — which are preserved for v5 training.
--
-- Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260606_null_baseline_scores.sql

-- 1) Snapshots: the source of truth the leaderboard ranks.
UPDATE webcam_snapshots
SET ai_regression_score     = NULL,
    ai_rating               = NULL,
    scoring_path            = NULL,
    model_disagreement_kind = NULL
WHERE scoring_path IN ('baseline', 'baseline-fallback');

-- 2) Denormalized AI values on webcams (written by the live-cron baseline path).
--    webcams has no per-row scoring_path, so null all denormalized AI ratings
--    and let the next real ONNX score re-sync each webcam. webcams.rating
--    (human) is intentionally NOT in this list.
UPDATE webcams
SET ai_rating            = NULL,
    ai_rating_regression = NULL,
    ai_rating_binary     = NULL;
```

- [ ] **Step 2: Verify the migration is safe to run (dry inspection)**

Run: `grep -n "rating\|scoring_path\|ai_" database/migrations/20260606_null_baseline_scores.sql`
Confirm by eye: no reference to `webcam_snapshot_ratings`, `initial_rating`, or the bare `webcams.rating` column in any `SET` clause.

- [ ] **Step 3: Commit (operator applies the SQL manually — see Operational steps)**

```bash
git add database/migrations/20260606_null_baseline_scores.sql
git commit -m "feat(db): migration to null fabricated baseline scores (manual ratings untouched)"
```

> **Operational (owner runs after merge):** `psql "$DATABASE_URL" -f database/migrations/20260606_null_baseline_scores.sql`. Before/after sanity:
> `SELECT count(*) FROM webcam_snapshots WHERE scoring_path IN ('baseline','baseline-fallback');` should go to 0;
> `SELECT count(*) FROM webcam_snapshot_ratings;` must be unchanged.

---

## Task 7: Compound-engineering learning

**Files:**
- Create: `docs/solutions/2026-06-06-fallbacks-must-not-impersonate-real-signal.md`

- [ ] **Step 1: Write the learning doc**

```markdown
# Fallbacks must not impersonate the real signal

**Date:** 2026-06-06
**Area:** ML scoring / data integrity

## The trap

`scoreImage` had a "fallback": when the ONNX model failed to load, it scored the
image from **webcam popularity + a default manual rating** (`baselineRaw`) and
wrote that guess into `ai_regression_score` / `ai_rating` — the SAME columns the
real model writes. The mode selector even defaulted to it
(`AI_SCORING_MODE_DEFAULT = 'baseline'`), so a missing env var silently
fabricated scores. Two writers (the Windy cron and `customBackfill`) shipped the
guess to the DB; the leaderboard ranked it as if it were real. Result: broken
infrastructure looked perfectly healthy, and "we think it's working but it isn't"
recurred for weeks.

## The rule

**A fallback that writes a plausible value into the same column as the real
signal is worse than no fallback — it is undetectable.** A heuristic that never
reads the input it claims to score produces silent, confidently-wrong data.

Fallbacks must be either:
1. **Absent** — write `NULL`, increment a counter, log loudly. Honest absence is
   recoverable (a `WHERE col IS NULL` finder reclaims it); a fake number is not.
2. **A distinct, clearly-labeled channel** — never the column reserved for the
   real signal.

And never default a mode selector to the fake path.

## What we did

Deleted `baselineRaw` + the `AI_SCORING_MODE` knob; `scoreImage` now returns
`pathTaken: 'unscored'` with `null` scores on any ONNX failure; all writers skip
the write on `'unscored'`; a migration nulled the existing junk so the real model
reclaims it. See `docs/superpowers/specs/2026-06-06-remove-metadata-heuristic-fallback-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/solutions/2026-06-06-fallbacks-must-not-impersonate-real-signal.md
git commit -m "docs(solutions): learning — fallbacks must not impersonate the real signal"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (scoreImage stops manufacturing) → Task 1. ✅
- Spec §2 (kill `'baseline'` default mode) → Task 1 (remove mode branch) + Task 2 (delete the constant). ✅
- Spec §3a/b/c (three writers) → Task 3 (Windy), Task 4 (customBackfill), Task 5 (smoke null-tolerance). ✅
- Spec §4 (cleanup migration) → Task 6. ✅
- Spec §5 (tests) → TDD steps in Tasks 1, 3, 4. ✅
- Spec "compound-engineering learning" → Task 7. ✅
- Scope boundary (manual ratings off-limits) → enforced in Task 6 SQL + verified in its Step 2. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"add validation" steps; every code step shows complete code. The one soft spot — exact mock variable names in `route.test.ts` / `customBackfill.test.ts` — is called out explicitly with the file's visible names and an instruction to match. Acceptable: the implementer reads the test file's top-of-file mock declarations.

**Type consistency:** `ScorePath`, `rawScore: number | null`, `aiRating: number | null`, the `rawScore === null || aiRating === null` guard, and `scoringPaths: Record<'onnx' | 'cache-hit' | 'unscored', number>` are used identically across Tasks 1, 3, 4. `scoreBinary` → `undefined` on failure matches the Task 1 test assertions (`binaryPathTaken` undefined). ✅

**Integration note:** Phase 2 (`feat/three-judge-p2`) also edits `aiScoring.ts` (`computeDisagreementKind`) and adds `archiveBackfill.ts` (which already has the `pathTaken !== 'onnx'` gate). When Phase 2 lands, reconcile: Phase 2's `archiveBackfill` gate should adopt the `'unscored'` path name, and the `ScorePath`/nullable-`rawScore` changes here must be merged into Phase 2's copy of `aiScoring.ts`. The `/code-review ultra 44` findings may overlap here — fold them in at merge.
