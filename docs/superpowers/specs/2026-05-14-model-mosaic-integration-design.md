# Model → Mosaic / Kiosk Integration Design

**Date:** 2026-05-14
**Status:** Draft
**Branch context:** `feat/tier-0-cameras` — this spec extends the existing Tier 0 camera work, not a parallel design.

---

## Overview

The v4 ResNet18 regression model (Pearson r = 0.90 on held-out data, published as `v4_regression_llm_with_flickr`) is trained, exported to ONNX, and sitting on disk in `ml/artifacts/models/regression_resnet18/`. The mosaic and kiosk both already read `aiRatingRegression` from the database to drive tile size. But the value in that column today is not from v4 — it's from the cron's `'baseline'` mode, which scores webcams from metadata (view count + manual rating) rather than from the actual image. The ONNX scoring path that exists in `app/api/cron/update-windy/lib/aiScoring.ts` is a "compatibility bridge" that feeds the model a 3-number metadata vector, not pixels.

Separately, `database/migrations/20260503_cameras_schema.sql` and `docs/device-protocol.md §9.4` already define the schema and winner-selection contract for surfacing snapshots in the mosaic — but the winner-selection logic itself is not yet implemented (no `is_window_winner` writes anywhere in app code). The Tier 0 plan's scope ended at "the Pi can post a snapshot;" picking winners and gating storage cost was deferred.

This spec describes how to:

1. **Phase 1** — Wire the v4 ONNX model up to score real images and write back `ai_rating_regression`, with a Redis hash short-circuit so we don't burn money re-scoring identical bytes every minute.
2. **Phase 2** — Implement the already-specified winner selection per `device-protocol.md §9.4`, **plus** a new global daily cap layered on top of winners so Firebase storage stays bounded.

A Phase 3 sketch (live video scoring) is future work, not designed in detail.

---

## What's already in place vs. what this spec adds

**Already in place (do not re-build):**

| Thing | Where |
|-------|-------|
| `webcams.source` column with `'windy' | 'custom'` values | `20260503_cameras_schema.sql` step 4 |
| `webcams.custom_camera_id` back-pointer to `cameras` table | `20260503_cameras_schema.sql` step 4 |
| `cameras` table (Pi edge device registration) | `20260503_cameras_schema.sql` step 2 |
| `webcam_snapshots.edge_score`, `edge_model_version`, `window_id`, `is_window_winner` | `20260503_cameras_schema.sql` step 6 |
| `webcam_snapshots_winners_idx` | `20260503_cameras_schema.sql` step 6 |
| Snapshot upload endpoint (`POST /api/cameras/[id]/snapshot`) | `app/api/cameras/[id]/snapshot/route.ts` |
| Cron filter that excludes `source='custom'` from terminator deactivation | `dbOperations.ts` (per Tier 0 plan) |
| Upstash Redis client + `terminator:current` payload cache (300s TTL) | `app/lib/cache.ts` |
| `WINNER_POLICY_CUSTOM` + `WINNER_POLICY_WINDY` semantics | `device-protocol.md §9.4.1, §9.4.2` (spec only — no code yet) |

**What this spec adds:**

| Thing | Phase |
|-------|-------|
| Real ONNX image inference in `scoreImage()` (replaces metadata bridge) | 1 |
| Redis-backed per-camera image-hash short-circuit | 1 |
| Rename `/api/cron/update-windy` → `/api/cron/update-cameras` (source-agnostic) | 1 |
| `daily_sunset_stats` table for observability | 1 |
| `WINNER_POLICY_CUSTOM` + `WINNER_POLICY_WINDY` config in `masterConfig.ts` | 2 |
| Server-side winner-selection logic (writes `is_window_winner`) | 2 |
| `webcam_snapshots.ai_regression_score` + model version column (gap in current schema) | 2 |
| Global daily cap on winners (new — not in device protocol) | 2 |
| End-of-day cleanup cron (prunes capped-out winners' Firebase blobs) | 2 |

---

## Goals

- The score in `webcams.ai_rating_regression` is a real image-derived score from the v4 model, for both `source='windy'` and `source='custom'` rows.
- The mosaic and kiosk reflect real model quality in tile sizes via the existing read path. **No other UX changes**: geographic layout is preserved (N top, S bottom, E right, W left), no cameras hidden, no ranking, no badges. The mosaic is a visual rendering of the terminator line — sacred.
- Snapshots are surfaced in the mosaic per `is_window_winner = true` (cross-source contract).
- Long-term Firebase storage is capped by a per-day global limit on winners kept; losers are deleted after a short retention.
- The codebase treats `'windy'` and `'custom'` symmetrically — sources are rows, not branches.
- Neon write volume is dominated by gating logic, not by ceremony.

## Non-goals

- New mosaic UX (filtering, ranking, highlights, score badges) — explicitly excluded.
- Live video frame scoring — sketched as Phase 3, not built.
- Redesigning the winner-selection algorithm itself — using `device-protocol.md §9.4` as authoritative.
- Replacing the dual scoring scale (`rawScore` 0..1 vs `aiRating` 0..5). Both kept for compatibility.
- Pi edge camera firmware work — separate repo.

---

## Section 1: Architecture overview

```
                    ┌────────────────────────────┐
                    │  Vercel cron — every 1 min │
                    └──────────────┬─────────────┘
                                   │
                ┌──────────────────▼──────────────────┐
                │  /api/cron/update-cameras           │
                │  (renamed; source-agnostic)         │
                └──┬────────────────────────────────┬─┘
                   │                                │
                   ├── webcams WHERE source IN      │
                   │     ('windy','custom') AND     │
                   │     in terminator_webcam_state │
                   │                                │
   ┌───────────────▼────────────┐    ┌──────────────▼──────────────┐
   │ For each webcam row:       │    │ daily_sunset_stats UPSERT    │
   │  1. fetch preview bytes    │    │ (every tick, by date PK)     │
   │  2. sha256 → Redis lookup  │    └──────────────────────────────┘
   │  3. if cache hit → skip    │
   │  4. else: ONNX v4 inference│
   │  5. UPDATE webcams.ai_     │
   │     rating_regression      │
   └───────────────────────────┘

Snapshot lifecycle (Phase 2):
  Custom camera POSTs frame → webcam_snapshots row (edge_score, window_id)
                                          │
                              ai_regression_score backfilled by cron
                                          │
                              window closes (5 min idle) → server picks winner
                                          │            ↓
                                          │    update is_window_winner=true on argmax
                                          │
  Windy cron fetches new preview → snapshot row (no edge_score, no window_id)
                                          │
                              every cron tick: recompute rolling-window winner per webcam_id
                                          │
                              update is_window_winner=true on argmax (last 90 min)

End-of-day cleanup cron (Phase 2):
  Across all sources, count yesterday's is_window_winner=true rows
  If > DAILY_WINNER_GLOBAL_CAP, demote lowest-scoring winners
  Optionally: delete Firebase blobs for losers older than LOSER_RETENTION_DAYS

Read path (unchanged):
  Kiosk + Mosaic
    → /api/db-terminator-webcams
    → Upstash Redis (terminator:current, 300s TTL)
    → on miss: Neon read + cache warm
```

### Key principles

- The existing cron is extended and renamed, not replaced. New cron only for end-of-day cleanup.
- Source-agnostic: Windy and custom rows flow through the same scoring path; winner selection branches on source.
- `is_window_winner` is the single cross-source contract — the kiosk reads it, both Windy and custom contribute to it.
- Image-hash short-circuit via Redis is mandatory at 1-minute cadence.
- Graceful degradation: ONNX, Redis, or Firebase failures fall back without crashing the cron.

---

## Section 2: Phase 1 — Real image inference + observability

### 2.1 Source-agnostic scoring function

Replace `scoreWebcamPreview(webcam: WindyWebcam)` with:

```ts
// app/api/cron/update-cameras/lib/aiScoring.ts

scoreImage(input: {
  webcamId: number;
  imageUrl: string;
  source: 'windy' | 'custom';
  lastImageHash?: string;     // from Redis, short-circuits when unchanged
  fallbackMeta?: {            // used only on ONNX failure
    viewCount?: number;
    manualRating?: number;
  };
}): Promise<{
  rawScore: number;        // 0..1 (model-native)
  aiRating: number;        // 0..5 (display scale; legacy compat)
  modelVersion: string;
  imageHash: string;       // sha256 of fetched bytes
  source: 'windy' | 'custom';
  pathTaken: 'onnx' | 'cache-hit' | 'baseline-fallback';
}>
```

Steps:

1. Fetch image bytes via `downloadImage` from `app/lib/webcamSnapshot.ts`.
2. Compute SHA256 → `imageHash`.
3. If `imageHash === lastImageHash`, return `pathTaken: 'cache-hit'`. Caller skips DB writes.
4. Decode JPEG → 224×224 tensor. ImageNet normalize.
5. Run ONNX inference using the cached `InferenceSession`.
6. Map output to `aiRating` via `normalizeScore` (existing helper).
7. On any failure: fall back to baseline metadata score, mark `pathTaken: 'baseline-fallback'`, log.

### 2.2 Image-hash short-circuit storage — Redis only

Per-camera cache state lives in Upstash, not in Neon:

```
camera:hash:{source}:{webcamId}        TTL 24h   value: sha256
camera:scored_at:{source}:{webcamId}   TTL 24h   value: ISO timestamp
```

`{source}` keyspace avoids collisions if a Windy webcam and a custom camera ever share a numeric ID. Cache loss is non-fatal — next tick re-infers and repopulates. **No `last_image_hash` column on `webcams`.**

Expected hit rate: 70–90% on a typical tick (most webcam previews refresh every 5–10 min, not every 60 s).

### 2.3 Renamed orchestrator

`app/api/cron/update-windy/` → `app/api/cron/update-cameras/`. Subdirectory `lib/` moves with it. `vercel.json` cron path updates.

Internal changes beyond renaming:

- Iterates over all `webcams` rows currently in `terminator_webcam_state` regardless of source.
- **For `source='windy'` rows:** use `images.current.preview` as the image URL (existing path). The cron scores the live preview and writes the result to `webcams.ai_rating_regression` (this is what the mosaic reads for tile size). It does **not** insert `webcam_snapshots` rows for Windy — those come only when a snapshot is intentionally captured by other code paths.
- **For `source='custom'` rows:** the device POSTs frames directly to `POST /api/cameras/[id]/snapshot`, which inserts a `webcam_snapshots` row with `image_url`, `edge_score`, `window_id` — but no AI score. The cron's job for custom rows is to:
  1. Find any `webcam_snapshots` rows for this camera with `ai_regression_score IS NULL` and a populated `image_url`.
  2. Score each via `scoreImage()`.
  3. Write `ai_regression_score` and `ai_model_version_regression` back on the snapshot row.
  4. Also UPDATE `webcams.ai_rating_regression` for the camera's row to the most recent snapshot's score (so the mosaic tile sizes for custom cameras reflect their latest captured moment).
- Bounded concurrency: batches of 10 with `Promise.all`.
- Per-image fetch+inference timeout: 3 s.
- Soft tick deadline at 50 s. Stop processing new items; next tick picks up via cache-gate (Windy) or `ai_regression_score IS NULL` query (custom).

### 2.4 Deprecation of `/api/cron/update-windy`

Keep the old route alive for one or two deploys as a thin re-export:

```ts
// app/api/cron/update-windy/route.ts
// DEPRECATED: remove after 2026-05-18 (≥48h post-deploy, zero traffic confirmed)
export { GET } from '../update-cameras/route';
```

Removal criteria:
- New cron has run successfully for ≥48 hours.
- Vercel logs show zero hits to the old path.

### 2.5 Daily stats table

```sql
CREATE TABLE daily_sunset_stats (
  date              date PRIMARY KEY,           -- UTC date
  model_version     text NOT NULL,
  webcams_scored    int  NOT NULL DEFAULT 0,
  cache_hits        int  NOT NULL DEFAULT 0,
  fallbacks         int  NOT NULL DEFAULT 0,
  score_avg         numeric(4,3),
  score_p50         numeric(4,3),
  score_p90         numeric(4,3),
  score_p99         numeric(4,3),
  above_min_score_to_win_count int NOT NULL DEFAULT 0,
  source_breakdown  jsonb,                      -- per-source rollup
  -- Phase 2 winner-tracking columns; nullable in Phase 1
  winners_picked    int,
  winners_kept      int,
  winners_pruned    int,
  top_winner_score  numeric(4,3),
  finalized_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

UPSERTed once per cron tick by date PK. Real-time-readable for any "today's leaderboard" or live banner. Percentiles computed in-tick from in-memory scores.

`source_breakdown` example: `{"windy": {"scored": 280, "avg": 0.42}, "custom": {"scored": 3, "avg": 0.71}}`.

### 2.6 What does *not* change in Phase 1

- The mosaic and kiosk pages — already read `aiRatingRegression`. Tile sizes update automatically once the column holds real scores.
- The snapshot upload endpoint (`POST /api/cameras/[id]/snapshot`) — already implemented in Tier 0 work.
- `is_window_winner` writes — those come in Phase 2.

### 2.7 Existing `source` discriminator

The `webcams.source` column already exists. This spec does **not** add or rename it. The `'custom'` value (not `'pi-edge'`) is the established convention. Source values are constrained by application logic, not a CHECK constraint, per the existing migration.

---

## Section 3: Phase 2 — Winner selection + global cap

Phase 2 ships only after ~a week of Phase 1 data is in `daily_sunset_stats`. Threshold and cap numbers are picked from observed distributions, not guessed.

### 3.1 Winner selection — implement device-protocol.md §9.4

This is the work the Tier 0 plan deferred. Two per-source policies, both in `app/lib/masterConfig.ts`:

```ts
export const WINNER_POLICY_CUSTOM = {
  EDGE_WEIGHT: 0.3,
  AI_WEIGHT: 0.7,
  MIN_SCORE_TO_WIN: 0.4,
  WINDOW_CLOSE_GRACE_S: 300,
};

export const WINNER_POLICY_WINDY = {
  AI_WEIGHT: 1.0,
  MIN_SCORE_TO_WIN: 0.5,
  ROLLING_WINDOW_MIN: 90,
};
```

**Custom-camera winner picking** (event-driven):
- Trigger: cron observes `cameras.last_heartbeat_at < now() - WINDOW_CLOSE_GRACE_S` for cameras that recently had snapshots, AND no new `webcam_snapshots` for that `window_id` in the grace period.
- For the closed window: `SELECT * FROM webcam_snapshots WHERE window_id = ?`.
- Compute `score = edge_score * EDGE_WEIGHT + ai_regression_score * AI_WEIGHT` per row.
- If max(score) < `MIN_SCORE_TO_WIN`: no winner set for the window.
- Else: `UPDATE webcam_snapshots SET is_window_winner = true WHERE id = <argmax>;`

**Windy winner picking** (per-tick):
- Each cron tick, for each Windy webcam that had snapshots in the last 90 min:
- `SELECT * FROM webcam_snapshots WHERE webcam_id = ? AND source='windy' AND captured_at > now() - interval '90 minutes' ORDER BY ai_regression_score DESC LIMIT 1;`
- If top score ≥ `MIN_SCORE_TO_WIN`: set `is_window_winner = true` on that row, demote any other true rows for the same `webcam_id`.

(Note: Windy webcams don't have `window_id`. The unique-winner-per-webcam constraint is enforced by demotion logic, not a unique index.)

### 3.2 Global daily winner cap (new, beyond the protocol)

The device protocol picks winners but doesn't bound their volume. On a great-sunset day, 300+ Windy webcams could all clear `MIN_SCORE_TO_WIN`. We need a cap to prevent Firebase blob accumulation.

New config:

```ts
export const DAILY_WINNER_GLOBAL_CAP = 100;       // start mid-range; range 50–200
export const LOSER_RETENTION_DAYS = 7;            // how long to keep is_window_winner=false rows
```

End-of-day cleanup cron at `10 0 * * *` (00:10 UTC daily), `/api/cron/cleanup-daily-snapshots`:

```
yesterday = current_date - 1 (UTC)

# 1. Cap winners
winners = SELECT * FROM webcam_snapshots
  WHERE captured_at::date = yesterday AND is_window_winner = true
  ORDER BY ai_regression_score DESC
if winners.length > DAILY_WINNER_GLOBAL_CAP:
  for row in winners[DAILY_WINNER_GLOBAL_CAP:]:
    UPDATE webcam_snapshots SET is_window_winner = false WHERE id = row.id
  # blobs of demoted rows fall under LOSER_RETENTION_DAYS sweep below

# 2. Delete old loser blobs
loser_threshold = current_date - LOSER_RETENTION_DAYS (UTC)
SELECT * FROM webcam_snapshots
  WHERE captured_at::date <= loser_threshold
    AND is_window_winner = false
    AND image_url IS NOT NULL
for each: deleteImage(image_url); UPDATE webcam_snapshots SET image_url = NULL

# 3. Finalize daily_sunset_stats
UPDATE daily_sunset_stats SET
  winners_picked = ?, winners_kept = ?, winners_pruned = ?,
  top_winner_score = ?, finalized_at = now()
WHERE date = yesterday;
```

`image_url = NULL` indicates the blob is gone but the row stays (kept for re-rank-when-models-improve, per the protocol's spirit — except we've lost the actual bytes, so re-ranking can't happen). The DB row + score history are kept forever. Cheap.

If Firebase delete fails for a row, leave `image_url` populated. Next day retries.

### 3.3 One small schema gap to close

`device-protocol.md §9.4.1`'s formula references `ai_regression_score` on `webcam_snapshots`, but that column does not currently exist on the table. Add it (and the accompanying model-version column) so winner selection can read it:

```sql
-- Phase 2 migration: enable winner selection by giving snapshots a server-side
-- AI regression score paired with the model version that produced it.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS ai_regression_score        numeric(4,3),
  ADD COLUMN IF NOT EXISTS ai_model_version_regression text;

-- Read pattern for Windy rolling-window winner picking
CREATE INDEX IF NOT EXISTS webcam_snapshots_ai_regression_idx
  ON webcam_snapshots (webcam_id, captured_at DESC)
  WHERE ai_regression_score IS NOT NULL;
```

Everything else for Phase 2 is purely application logic — `is_window_winner`, `window_id`, `edge_score`, `edge_model_version` all already exist.

**Note on `llm_quality`.** The existing `webcam_snapshots.llm_quality` column (from migration `20260417_add_llm_quality_to_snapshots.sql`) holds *LLM-derived* ratings from `ml/llm_rater.py` — Sonnet / Gemini / GPT scoring used during training data preparation. It is intentionally separate from `ai_regression_score`, which is our trained v4 model's output. Both can coexist; winner selection uses only `ai_regression_score`.

### 3.4 Great-sunset-day surfacing

`daily_sunset_stats` from Phase 1 already records `above_min_score_to_win_count`. Phase 2 adds `winners_kept` and `top_winner_score`. Queries become trivial:

```sql
SELECT date, winners_kept, top_winner_score
FROM daily_sunset_stats
WHERE finalized_at IS NOT NULL
ORDER BY winners_kept DESC
LIMIT 20;
```

UI for this is out of scope for Phase 2 itself — data availability is the commitment.

### 3.5 Firebase delete uses existing helper

Cleanup uses `deleteImage` already in `app/lib/webcamSnapshot.ts`. Storage rows in Neon stay (cheap); only the JPEG blobs are deleted.

---

## Section 4: Cost discipline + Redis strategy

### 4.1 Existing pattern (unchanged)

`/api/db-terminator-webcams` reads from Upstash Redis (`terminator:current`, 300 s TTL). The cron writes the warm payload after each Neon update. Kiosk and browser refreshes hit Redis, not Neon, under normal traffic.

### 4.2 What goes where

Redis (ephemeral):
- Per-camera image hash + last-scored timestamp (24 h TTL)
- Terminator payload cache (existing)

Neon (durable, queryable):
- `webcams.ai_rating_regression`, `ai_model_version_regression`, `source` (already exist)
- `webcam_snapshots` rows including `edge_score`, `window_id`, `is_window_winner` (already exist)
- `daily_sunset_stats` UPSERTed every cron tick (cheap, real-time)

### 4.3 Score-write gating

```ts
const lastHash = await redis.get(`camera:hash:${source}:${webcamId}`);
if (lastHash === newHash) {
  return { pathTaken: 'cache-hit' };  // no Neon write, no inference
}
// real inference + single Neon UPDATE
```

Net: ~70–90% of cameras incur zero Neon writes per tick.

### 4.4 Cost summary

| Operation | Plan |
|---|---|
| Kiosk reads `/api/db-terminator-webcams` | Redis (unchanged) |
| Per-camera score write | Neon, only when image hash changed |
| Hash cache state | Redis only |
| `daily_sunset_stats` UPSERT | Neon, every tick (1 row by PK, real-time) |
| Snapshot save | Existing path; Phase 2 doesn't add saves |
| Winner flag flips | Neon UPDATE, infrequent (window close OR cron tick for Windy) |
| Cleanup cron | Once daily — winner cap UPDATEs + Firebase deletes |

### 4.5 Explicitly not cached in Redis

- ONNX file — already in Node process memory (`cachedSessions` Map in `aiScoring.ts`)
- Raw image bytes — single use; only the hash is cached

---

## Section 5: Error handling + graceful degradation

The cron never goes dark. If anything fails, the mosaic and kiosk render with whatever score and winner flags were last in Neon.

### 5.1 Failure modes

| Failure | Scope | Response | Logging |
|---|---|---|---|
| Image fetch fails | Per-camera | Skip, keep prior score, retry next tick | warn |
| Image decode fails | Per-camera | Skip; likely transient | warn |
| ONNX session fails to LOAD | Process-wide | Cron falls back to baseline metadata score | **error** |
| ONNX inference per image fails | Per-camera | Skip. If >20% NaN in a tick, halt scoring for the rest of the tick | warn → error |
| Score outside [0, 1] | Per-camera | Clamp, log | info |
| Redis unavailable | Process-wide | All cache misses → re-infer (slow but correct) | warn |
| Neon unavailable | Process-wide | Tick fails, retries next minute; kiosk serves from Redis | error |
| Vercel timeout (>50 s soft deadline) | Per-tick | Stop processing new cameras, log remaining | warn |
| Firebase delete during cleanup fails | Per-row | Leave `image_url` populated, retry next day | warn |
| Winner selection finds no clearer (<MIN_SCORE_TO_WIN) | Per-window | No winner set; previous winner (if any) stays demoted | info |

### 5.2 Rollback levers (no redeploy needed)

```
AI_SCORING_MODE = 'onnx' | 'baseline'           # full kill switch
AI_REGRESSION_MODEL_VERSION = 'v4'              # downgrade to 'v3' or older
AI_ONNX_REGRESSION_MODEL_PATH = '...'           # any artifact in ml/artifacts/
```

If v4 misbehaves: flip via Vercel dashboard in seconds. Cached ONNX session resets on next cold start; or `cachedSessions.clear()` for instant effect.

---

## Section 6: Testing strategy

### 6.1 Unit tests

| Module | What's tested |
|---|---|
| `scoreImage()` | Mock image bytes + ONNX. Cover `onnx`, `cache-hit`, `baseline-fallback`. Assert `rawScore ∈ [0,1]`, `aiRating ∈ [0,5]`. |
| Preprocessing | Fixed JPEG → deterministic tensor. |
| Winner selection — custom | Given snapshots with `edge_score` + `ai_regression_score` for one `window_id`, the argmax of the weighted sum gets `is_window_winner = true`; others stay false; below `MIN_SCORE_TO_WIN` → none flagged. |
| Winner selection — Windy | Rolling 90-min window: a newer higher score demotes the old winner. |
| Daily cap cleanup | N winners + cap K → exactly K remain `is_window_winner = true`. |
| Loser sweep | `image_url` cleared for old losers after `LOSER_RETENTION_DAYS`. DB row stays. |
| Redis helpers | `getHash`, `setHash`, `incrementDailyCounter`, including Redis-down fallback paths. |

### 6.2 Integration tests

| Scenario | Setup | Assertion |
|---|---|---|
| Happy path one tick | Mock Windy returns 5 webcams; real Redis + test Neon | All 5 scored, written, no errors |
| Cache hit short-circuit | Run tick twice, no image change | Second tick: zero inferences, zero Neon writes |
| Source-agnostic | Inject a fake `source='custom'` row | Same scoring path; `source` field preserved |
| Custom-camera winner | Insert 3 snapshots with same `window_id` + simulate window close | Top combined-score row gets `is_window_winner = true` |
| ONNX broken | Rename ONNX file | Cron completes via baseline; error log emitted |

### 6.3 Manual verification

- Phase 1 deploy: eyeball 10 webcams' new `ai_rating_regression` against their actual images. 0.90 Pearson doesn't guarantee per-image plausibility.
- Phase 2 deploy: watch the cleanup cron run once. Confirm: winners capped, Firebase Storage usage drops over the following week as old losers' blobs are deleted, `daily_sunset_stats.winners_kept` reflects reality.

### 6.4 Out of scope

- Kiosk Pi itself (thin Chromium client)
- Pi edge camera firmware (separate repo)
- Windy API (third party, mocked)

---

## Phase 3 (future, sketched only): live video scoring

Pi edge cameras will eventually stream live video during sunrise/sunset windows. Scoring video differs from stills:

- **Frame sampling.** ResNet18 takes one image. A 30 fps stream needs sub-sampling (~0.5–1 fps).
- **Temporal smoothing.** Mosaic tile sizes that strobe per-frame are unwatchable. The driving score should be a rolling average over ~30 s.
- **Streaming hook.** Most natural at HLS segment level: when a new segment lands, decode its middle frame, score it, push to the rolling average.
- **Snapshot extraction.** Saving a "frame from a stream" reuses the same scoring path — there's no separate code path.

Phase 1's source-agnostic `scoreImage()` means the moment a still arrives (Windy preview, Pi snapshot, or sampled HLS frame), it flows through the same code with no changes.

---

## Open numerical decisions (deferred to Phase 1 data)

These are picked from observed `daily_sunset_stats` after a week:

- `WINNER_POLICY_WINDY.MIN_SCORE_TO_WIN` — currently `0.5` per the device protocol; tune from p80–p90 of the daily distribution.
- `WINNER_POLICY_CUSTOM.MIN_SCORE_TO_WIN` — currently `0.4`; tune once custom cameras have data.
- `DAILY_WINNER_GLOBAL_CAP` — start `100`, range 50–200, willing to raise on great-sunset days.
- `LOSER_RETENTION_DAYS` — start `7`; if Firebase usage is comfortable, raise to 14 or 30 for better re-rank capability.
- Bounded inference concurrency (currently `10`) — tune from observed per-tick latency.
- 24 h TTL on `camera:hash:*` Redis keys — adjust if hit rate suggests otherwise.

---

## Future cleanup (acknowledged, not bundled)

- Collapse the dual scoring scale (`rawScore` 0..1 vs `aiRating` 0..5). The 0..5 scale is legacy; eventual cleanup is "everything moves to 0..1, retune mosaic on 0..1." Coordinated migration; not now.
- Loser-blob deletion currently zeroes `image_url`. A future migration could add `image_url_deleted_at timestamptz` for cleaner audit; not needed now.

---

## Files changed (estimate)

**Phase 1:**
- Move: `app/api/cron/update-windy/` → `app/api/cron/update-cameras/`
- Add: `app/api/cron/update-windy/route.ts` (thin re-export, deprecated)
- Rewrite: `aiScoring.ts` (`scoreImage`, real ONNX path, source-agnostic)
- Modify: `update-cameras/route.ts` (bounded concurrency, deadline, source iteration)
- Modify: `app/lib/cache.ts` (add `camera:hash:*` helpers)
- Modify: `vercel.json` (cron path)
- New SQL migration: create `daily_sunset_stats` table
- Tests as listed in Section 6.1, 6.2

**Phase 2:**
- New: `app/api/cron/update-cameras/lib/winnerSelection.ts` (custom + Windy logic)
- Modify: `update-cameras/route.ts` (call winner selection at end of tick; backfill `ai_regression_score` on snapshot rows for `source='custom'` cameras)
- New: `app/api/cron/cleanup-daily-snapshots/route.ts`
- Modify: `vercel.json` (new cron entry)
- Modify: `app/lib/masterConfig.ts` (`WINNER_POLICY_*`, `DAILY_WINNER_GLOBAL_CAP`, `LOSER_RETENTION_DAYS`)
- New SQL migration: add `webcam_snapshots.ai_regression_score`, `ai_model_version_regression`, and supporting index
- Tests as listed in Section 6.1, 6.2
