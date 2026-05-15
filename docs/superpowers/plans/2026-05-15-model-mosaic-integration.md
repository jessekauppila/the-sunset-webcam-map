# Model → Mosaic / Kiosk Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the trained ResNet18 regression ONNX model into the cron so `webcams.ai_rating_regression` reflects real image scores, then implement device-protocol §9.4 winner selection with a global daily cap.

**Architecture:** Two phases shipped sequentially. Phase 1 swaps the metadata-bridge ONNX adapter for real JPEG-bytes-to-tensor inference, gates re-scoring with a per-camera Redis image-hash cache, renames `update-windy` → `update-cameras` (source-agnostic), backfills `ai_regression_score` on custom-camera snapshots, and adds a `daily_sunset_stats` observability table. Phase 1 ships standalone and runs for ~a week to build a score distribution. Phase 2 then implements `is_window_winner` selection (per-source policies in `masterConfig.ts`), a global daily winner cap, and an end-of-day cleanup cron that prunes losing Firebase blobs.

**Tech Stack:** Next.js App Router (Vercel cron), Neon Postgres via `@neondatabase/serverless`, Upstash Redis via `@upstash/redis`, `onnxruntime-node` (to install), `sharp` for JPEG decode + ImageNet preprocessing (to install), Firebase Storage via `firebase-admin`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-14-model-mosaic-integration-design.md`. Read it before starting any task — this plan is the execution layer, not the design.

---

## Preflight assumptions and deviations from the spec

These are calls made during planning that the spec doesn't pin down. Each is annotated so reviewers can flag any they disagree with.

1. **`ai_regression_score` column added in Phase 1, not Phase 2.** The spec's §3.3 puts the migration in Phase 2, but §2.3 has Phase 1 writing to that column for custom-camera backfill. The column has to exist before Phase 1 can write to it, so this plan moves the `ALTER TABLE webcam_snapshots ADD COLUMN ai_regression_score…` into the Phase 1 migration. The Phase 2 migration becomes just the supporting partial index.
2. **Image-decode + preprocessing uses `sharp`.** It's the standard Node JPEG path, runs in Vercel's Node runtime, and supports resize + raw-pixel extraction in one pass — sufficient for 224×224 ImageNet normalize.
3. **`onnxruntime-node` is missing from `package.json` today.** The dynamic `import('onnxruntime-node')` in `aiScoring.ts` works because production runs in `baseline` mode and never reaches that line. Phase 1 adds the dep so `AI_SCORING_MODE=onnx` can be flipped on Vercel without redeploys.
4. **Model artifact path comes from env vars.** The artifact actually on disk is `ml/artifacts/models/regression_resnet18/20260315_003913_v2_regression_mild_crop/model.onnx`. The spec names it "v4_regression_llm_with_flickr" — that's aspirational. Don't hardcode either name in masterConfig defaults; rely on `AI_ONNX_REGRESSION_MODEL_PATH` + `AI_REGRESSION_MODEL_VERSION` in Vercel env vars.
5. **Custom-camera scoring is event-driven by `webcam_snapshots.ai_regression_score IS NULL`, not by re-running over `terminator_webcam_state`.** Spec §2.3 spells this out. Custom rows don't have a "preview URL" to poll the way Windy rows do — they only have rows in `webcam_snapshots`, and only those that the Pi has actually uploaded.
6. **Old `/api/cron/update-windy` route stays as a thin re-export for two weeks.** Removal is gated on "no traffic for ≥48h" — that's an operator decision after Phase 1 ships, not a task here. A follow-up cleanup commit will delete it.

---

## File Structure

### Phase 1 — files created or modified

```
app/api/cron/
├── update-cameras/                    # renamed from update-windy/
│   ├── route.ts                       # MODIFY: source-agnostic orchestration, calls customBackfill, dailyStats
│   ├── lib/
│   │   ├── aiScoring.ts               # REWRITE: scoreImage() — real ONNX image inference + hash cache + fallback
│   │   ├── imageHash.ts               # CREATE: sha256 helper, isolated for testability
│   │   ├── imagePreprocess.ts         # CREATE: JPEG bytes → 224×224 normalized Float32 tensor (sharp)
│   │   ├── customBackfill.ts          # CREATE: query null-score custom snapshots, score them, write back
│   │   ├── dailyStats.ts              # CREATE: per-tick aggregator + UPSERT to daily_sunset_stats
│   │   ├── dbOperations.ts            # MODIFY: keep moves + add updateSnapshotAiRegressionScore + updateWebcamFromLatestCustomSnapshot
│   │   ├── auth.ts                    # MOVE only
│   │   ├── windyApi.ts                # MOVE only
│   │   └── webcamClassification.ts    # MOVE only
└── update-windy/
    └── route.ts                       # CREATE: thin re-export, DEPRECATED, remove after 2026-05-29

app/lib/
└── cache.ts                           # MODIFY: add getCameraImageHash / setCameraImageHash / 24h TTL keys

database/migrations/
└── 20260515_model_mosaic_phase1.sql   # CREATE: daily_sunset_stats + ai_regression_score + ai_model_version_regression cols

vercel.json                            # MODIFY: cron path → /api/cron/update-cameras

package.json                           # MODIFY: add onnxruntime-node + sharp
```

### Phase 2 — files created or modified

```
app/api/cron/
├── update-cameras/
│   ├── route.ts                       # MODIFY: call pickCustomWindowWinners + pickWindyRollingWinners at end of tick
│   └── lib/
│       └── winnerSelection.ts         # CREATE: pickCustomWindowWinners, pickWindyRollingWinners
└── cleanup-daily-snapshots/
    ├── route.ts                       # CREATE: winner cap + loser blob delete + daily_sunset_stats finalize
    └── lib/
        └── cleanup.ts                 # CREATE: capYesterdaysWinners, sweepOldLoserBlobs, finalizeDailyStats

app/lib/
├── masterConfig.ts                    # MODIFY: WINNER_POLICY_CUSTOM, WINNER_POLICY_WINDY, DAILY_WINNER_GLOBAL_CAP, LOSER_RETENTION_DAYS
└── webcamSnapshot.ts                  # MODIFY: deleteImage() helper that takes a firebase URL (or use existing deleteFromFirebase)

database/migrations/
└── 20260516_model_mosaic_phase2.sql   # CREATE: webcam_snapshots_ai_regression_idx partial index

vercel.json                            # MODIFY: add /api/cron/cleanup-daily-snapshots cron entry
```

### Test files (every CREATE or REWRITE above gets one)

- `app/api/cron/update-cameras/lib/aiScoring.test.ts`
- `app/api/cron/update-cameras/lib/imageHash.test.ts`
- `app/api/cron/update-cameras/lib/imagePreprocess.test.ts`
- `app/api/cron/update-cameras/lib/customBackfill.test.ts`
- `app/api/cron/update-cameras/lib/dailyStats.test.ts`
- `app/api/cron/update-cameras/lib/winnerSelection.test.ts`
- `app/api/cron/cleanup-daily-snapshots/lib/cleanup.test.ts`
- `app/lib/cache.test.ts` (new — file has no tests today)

---

# Phase 1 — Real image inference + observability

## Task 1: Install image-decode + ONNX runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install onnxruntime-node sharp
```

- [ ] **Step 2: Sanity-check both modules import in Node**

Run:
```bash
node -e "import('onnxruntime-node').then(m => console.log('ort.InferenceSession:', !!m.InferenceSession))"
node -e "import('sharp').then(m => console.log('sharp:', typeof m.default))"
```

Expected: `ort.InferenceSession: true` and `sharp: function`. If either logs an error, stop and resolve before continuing — these gate every later task.

- [ ] **Step 3: Verify the test runner still loads**

Run: `npm test -- --run`
Expected: existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add onnxruntime-node + sharp for real image scoring"
```

---

## Task 2: Phase 1 schema migration

**Files:**
- Create: `database/migrations/20260515_model_mosaic_phase1.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 1 of the model-mosaic integration. Two unrelated additions in one
-- migration because they're both pre-requisites for the new cron tick:
--   1. daily_sunset_stats: observability/leaderboard rollups, UPSERTed every tick
--   2. webcam_snapshots.ai_regression_score + ai_model_version_regression:
--      written by the cron's custom-camera backfill (Phase 1) and read by
--      Phase 2 winner selection. The supporting partial index ships in
--      Phase 2 once we have row volume.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260515_model_mosaic_phase1.sql

CREATE TABLE IF NOT EXISTS daily_sunset_stats (
  date                            DATE PRIMARY KEY,           -- UTC date
  model_version                   TEXT NOT NULL,
  webcams_scored                  INTEGER NOT NULL DEFAULT 0,
  cache_hits                      INTEGER NOT NULL DEFAULT 0,
  fallbacks                       INTEGER NOT NULL DEFAULT 0,
  score_avg                       NUMERIC(4,3),
  score_p50                       NUMERIC(4,3),
  score_p90                       NUMERIC(4,3),
  score_p99                       NUMERIC(4,3),
  above_min_score_to_win_count    INTEGER NOT NULL DEFAULT 0,
  source_breakdown                JSONB,
  -- Phase 2 winner-tracking columns; nullable in Phase 1
  winners_picked                  INTEGER,
  winners_kept                    INTEGER,
  winners_pruned                  INTEGER,
  top_winner_score                NUMERIC(4,3),
  finalized_at                    TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS ai_regression_score         NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_model_version_regression TEXT;
```

- [ ] **Step 2: Apply the migration to the local/dev Neon database**

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/20260515_model_mosaic_phase1.sql
```

Expected: `CREATE TABLE` and `ALTER TABLE` (or `NOTICE` / `IF NOT EXISTS` skip lines) — no errors.

- [ ] **Step 3: Verify schema took**

Run:
```bash
psql "$DATABASE_URL" -c "\d daily_sunset_stats" -c "\d webcam_snapshots" | grep -E "ai_regression_score|score_p50|finalized_at"
```

Expected: matches three columns: `ai_regression_score`, `score_p50` (on `daily_sunset_stats`), `finalized_at` (on `daily_sunset_stats`).

- [ ] **Step 4: Commit**

```bash
git add database/migrations/20260515_model_mosaic_phase1.sql
git commit -m "db: add daily_sunset_stats + webcam_snapshots.ai_regression_score (phase 1)"
```

---

## Task 3: Redis camera-image-hash helpers in app/lib/cache.ts

**Files:**
- Modify: `app/lib/cache.ts`
- Create: `app/lib/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/lib/cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn();
const delMock = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => ({ get: getMock, set: setMock, del: delMock }) },
}));

beforeEach(() => {
  // Pretend Upstash env vars exist so the real getClient() path runs.
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  process.env.KV_REST_API_TOKEN = 'token';
  process.env.USE_KV_CACHE = 'true';
  getMock.mockReset();
  setMock.mockReset();
  delMock.mockReset();
});

describe('camera image hash helpers', () => {
  it('getCameraImageHash reads from camera:hash:<source>:<webcamId>', async () => {
    const { getCameraImageHash } = await import('./cache');
    getMock.mockResolvedValue('abc123');

    const result = await getCameraImageHash('windy', 4242);

    expect(getMock).toHaveBeenCalledWith('camera:hash:windy:4242');
    expect(result).toBe('abc123');
  });

  it('setCameraImageHash writes with a 24h TTL', async () => {
    const { setCameraImageHash } = await import('./cache');

    await setCameraImageHash('custom', 99, 'sha256hex');

    expect(setMock).toHaveBeenCalledWith(
      'camera:hash:custom:99',
      'sha256hex',
      { ex: 60 * 60 * 24 }
    );
  });

  it('getCameraImageHash returns null when Redis is unavailable', async () => {
    delete process.env.KV_REST_API_URL;
    // Force re-import so the cached client is rebuilt without env vars.
    vi.resetModules();
    const { getCameraImageHash } = await import('./cache');
    const result = await getCameraImageHash('windy', 1);
    expect(result).toBeNull();
  });

  it('setCameraImageHash swallows Redis errors (cache is non-fatal)', async () => {
    setMock.mockRejectedValueOnce(new Error('upstash down'));
    const { setCameraImageHash } = await import('./cache');
    await expect(setCameraImageHash('windy', 1, 'h')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- --run app/lib/cache.test.ts`
Expected: FAIL with "getCameraImageHash is not exported" (or similar).

- [ ] **Step 3: Implement the helpers**

Append to `app/lib/cache.ts` (after the existing exports):

```ts
const CAMERA_HASH_TTL_SECONDS = 60 * 60 * 24;

type CameraSource = 'windy' | 'custom';

function cameraHashKey(source: CameraSource, webcamId: number): string {
  return `camera:hash:${source}:${webcamId}`;
}

export async function getCameraImageHash(
  source: CameraSource,
  webcamId: number
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return (await c.get<string>(cameraHashKey(source, webcamId))) ?? null;
  } catch (error) {
    console.error('Camera hash read failed:', error);
    return null;
  }
}

export async function setCameraImageHash(
  source: CameraSource,
  webcamId: number,
  imageHash: string
): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(cameraHashKey(source, webcamId), imageHash, {
      ex: CAMERA_HASH_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Camera hash write failed:', error);
  }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- --run app/lib/cache.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cache.ts app/lib/cache.test.ts
git commit -m "feat(cache): add per-camera image-hash Redis helpers (24h TTL)"
```

---

## Task 4: Rename update-windy directory to update-cameras

**Files:**
- Move: `app/api/cron/update-windy/route.ts` → `app/api/cron/update-cameras/route.ts`
- Move: `app/api/cron/update-windy/lib/*` → `app/api/cron/update-cameras/lib/*`
- Modify: `vercel.json`

The rename is mechanical. Behavior must be byte-identical at the end of this task — no logic changes. Behavior changes come in later tasks.

- [ ] **Step 1: Move every file with `git mv` (preserves history)**

```bash
git mv app/api/cron/update-windy app/api/cron/update-cameras
```

- [ ] **Step 2: Update vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/update-cameras",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Update any imports that referenced the old path**

Find them with:
```bash
grep -rn "update-windy" app/ --include="*.ts" --include="*.tsx"
```

For each hit, change the path to `update-cameras` (use Edit tool, not sed). Internal imports inside the moved dir use relative paths (`./lib/...`) so the rename shouldn't break them — only external imports need updating.

- [ ] **Step 4: Run the full test suite**

Run: `npm test -- --run`
Expected: every test that ran before still passes. If `dbOperations.test.ts` references the old path in `vi.mock` or `import` statements, fix it.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename update-windy cron to update-cameras (source-agnostic)"
```

---

## Task 5: Add deprecation re-export at /api/cron/update-windy/route.ts

**Files:**
- Create: `app/api/cron/update-windy/route.ts`

- [ ] **Step 1: Create the re-export**

```ts
// DEPRECATED: this path is preserved as a thin re-export so any legacy
// caller (Vercel cron cache, external monitoring) keeps working during
// the transition. Remove after 2026-05-29 once Vercel logs confirm
// ≥48h of zero traffic to this path.
export { GET } from '../update-cameras/route';
```

- [ ] **Step 2: Verify both routes resolve to the same handler**

Run:
```bash
grep -n "export.*GET" app/api/cron/update-windy/route.ts app/api/cron/update-cameras/route.ts
```

Expected: both files export `GET`; update-windy re-exports, update-cameras defines.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/update-windy/route.ts
git commit -m "chore: keep /api/cron/update-windy alive as deprecated re-export"
```

---

## Task 6: imageHash.ts — sha256 helper

**Files:**
- Create: `app/api/cron/update-cameras/lib/imageHash.ts`
- Create: `app/api/cron/update-cameras/lib/imageHash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './imageHash';

describe('sha256Hex', () => {
  it('returns the SHA-256 hex digest of a buffer', () => {
    const buf = Buffer.from('hello', 'utf8');
    // Known sha256 of "hello"
    expect(sha256Hex(buf)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('is deterministic for identical bytes', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 3]);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it('differs for different bytes', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 4]);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `npm test -- --run app/api/cron/update-cameras/lib/imageHash.test.ts`
Expected: FAIL — "Cannot find module".

- [ ] **Step 3: Implement**

```ts
import { createHash } from 'node:crypto';

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/imageHash.ts app/api/cron/update-cameras/lib/imageHash.test.ts
git commit -m "feat(scoring): add sha256Hex helper for image-hash caching"
```

---

## Task 7: imagePreprocess.ts — JPEG bytes → ImageNet tensor

**Files:**
- Create: `app/api/cron/update-cameras/lib/imagePreprocess.ts`
- Create: `app/api/cron/update-cameras/lib/imagePreprocess.test.ts`

The trained ResNet18 expects: input shape `[1, 3, 224, 224]`, channel order RGB, normalized with ImageNet mean `[0.485, 0.456, 0.406]` / std `[0.229, 0.224, 0.225]` per channel (per `model.meta.json` and standard PyTorch torchvision conventions).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { preprocessJpegToImagenetTensor } from './imagePreprocess';

async function makeRedJpeg(width = 300, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('preprocessJpegToImagenetTensor', () => {
  it('returns a Float32Array of length 3*224*224 in CHW layout', async () => {
    const jpeg = await makeRedJpeg();
    const tensor = await preprocessJpegToImagenetTensor(jpeg);
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * 224 * 224);
  });

  it('normalizes with ImageNet mean/std (red image -> R channel ≈ (1 - 0.485) / 0.229)', async () => {
    const jpeg = await makeRedJpeg();
    const tensor = await preprocessJpegToImagenetTensor(jpeg);

    // R channel is the first 224*224 slice (CHW layout).
    const rPlane = tensor.subarray(0, 224 * 224);
    const avg = rPlane.reduce((s, v) => s + v, 0) / rPlane.length;

    const expected = (1.0 - 0.485) / 0.229; // ≈ 2.249
    // JPEG is lossy; allow a generous tolerance.
    expect(avg).toBeGreaterThan(expected - 0.3);
    expect(avg).toBeLessThan(expected + 0.3);
  });

  it('throws on non-image bytes', async () => {
    await expect(
      preprocessJpegToImagenetTensor(Buffer.from('not an image'))
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import sharp from 'sharp';

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const TARGET_SIZE = 224;

/**
 * Decode a JPEG buffer, resize to 224×224, and return a Float32Array in
 * CHW layout (channel-major) with ImageNet mean/std normalization. The
 * returned array is the raw input the ONNX session expects — wrap it in
 * a Tensor at call site.
 */
export async function preprocessJpegToImagenetTensor(
  jpegBytes: Buffer
): Promise<Float32Array> {
  const { data, info } = await sharp(jpegBytes)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(
      `Expected 3 channels after preprocessing, got ${info.channels}`
    );
  }

  const pixels = TARGET_SIZE * TARGET_SIZE;
  const out = new Float32Array(3 * pixels);

  // sharp's raw output is HWC, byte-per-channel. Convert to CHW float.
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    out[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[pixels + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * pixels + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  return out;
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/imagePreprocess.ts app/api/cron/update-cameras/lib/imagePreprocess.test.ts
git commit -m "feat(scoring): JPEG -> 224x224 ImageNet tensor preprocessor"
```

---

## Task 8: Rewrite scoreImage() in aiScoring.ts

**Files:**
- Modify: `app/api/cron/update-cameras/lib/aiScoring.ts`
- Create: `app/api/cron/update-cameras/lib/aiScoring.test.ts`

Drop the metadata feature-vector path (`buildFeatureVector`, `scoreSingleModelWithOnnx`, `scoreWithOnnx`). Replace with `scoreImage(input)` that takes pre-fetched bytes and runs real ONNX inference. Keep `baselineScore()` as the fallback (it's still used on ONNX failure and when `AI_SCORING_MODE !== 'onnx'`).

The route layer (Task 11) owns image fetching and hash lookup — `scoreImage()` itself receives bytes plus the cache verdict so it stays unit-testable without HTTP.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const preprocessMock = vi.fn();
const sha256Mock = vi.fn();
const runMock = vi.fn();

vi.mock('./imagePreprocess', () => ({
  preprocessJpegToImagenetTensor: (...a: unknown[]) => preprocessMock(...a),
}));
vi.mock('./imageHash', () => ({
  sha256Hex: (...a: unknown[]) => sha256Mock(...a),
}));
vi.mock('onnxruntime-node', () => ({
  Tensor: vi.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      run: (...a: unknown[]) => runMock(...a),
    }),
  },
}));

import { scoreImage, __resetScoreImageCacheForTests } from './aiScoring';

describe('scoreImage', () => {
  beforeEach(() => {
    preprocessMock.mockReset().mockResolvedValue(new Float32Array(3 * 224 * 224));
    sha256Mock.mockReset().mockReturnValue('hash-abc');
    runMock.mockReset().mockResolvedValue({ output: { data: [3.2] } });
    process.env.AI_SCORING_MODE = 'onnx';
    process.env.AI_REGRESSION_MODEL_VERSION = 'test-v4';
    __resetScoreImageCacheForTests();
  });

  it('short-circuits when the new hash matches lastImageHash', async () => {
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      lastImageHash: 'hash-abc',
    });
    expect(result.pathTaken).toBe('cache-hit');
    expect(result.imageHash).toBe('hash-abc');
    expect(preprocessMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs ONNX inference when no matching hash, returns score in [0,1]', async () => {
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      lastImageHash: 'different',
    });
    expect(result.pathTaken).toBe('onnx');
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
    expect(result.aiRating).toBeGreaterThanOrEqual(0);
    expect(result.aiRating).toBeLessThanOrEqual(5);
    expect(result.modelVersion).toBe('test-v4');
    expect(preprocessMock).toHaveBeenCalledOnce();
  });

  it('clamps ONNX output above 5 to rating=5', async () => {
    runMock.mockResolvedValueOnce({ output: { data: [99] } });
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.aiRating).toBe(5);
    expect(result.rawScore).toBe(1);
  });

  it('falls back to baseline when ONNX inference throws', async () => {
    runMock.mockRejectedValueOnce(new Error('boom'));
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      fallbackMeta: { viewCount: 1000, manualRating: 4 },
    });
    expect(result.pathTaken).toBe('baseline-fallback');
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
  });

  it('preserves the source field on the return value', async () => {
    const result = await scoreImage({
      webcamId: 99,
      imageBytes: Buffer.from('jpeg'),
      source: 'custom',
    });
    expect(result.source).toBe('custom');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `npm test -- --run app/api/cron/update-cameras/lib/aiScoring.test.ts`
Expected: FAIL — old aiScoring.ts doesn't export `scoreImage`.

- [ ] **Step 3: Rewrite aiScoring.ts**

Replace the file's contents with:

```ts
/**
 * Real-image scoring for the update-cameras cron.
 *
 * scoreImage() takes pre-fetched JPEG bytes and returns a regression score
 * via the v4 ResNet18 ONNX model. A SHA-256 of the bytes lets callers
 * short-circuit re-scoring identical frames (Redis-backed at call site).
 * On any ONNX failure, falls back to the metadata-only baseline so the
 * cron never crashes.
 */

import path from 'node:path';
import {
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
  AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
  AI_SCORING_MODE_DEFAULT,
} from '@/app/lib/masterConfig';
import { sha256Hex } from './imageHash';
import { preprocessJpegToImagenetTensor } from './imagePreprocess';

export type WebcamSource = 'windy' | 'custom';

export interface ScoreImageInput {
  webcamId: number;
  imageBytes: Buffer;
  source: WebcamSource;
  /** From Redis. When equal to the new hash, returns cache-hit without scoring. */
  lastImageHash?: string;
  /** Used only when ONNX fails. Optional. */
  fallbackMeta?: { viewCount?: number; manualRating?: number };
}

export type ScorePath = 'onnx' | 'cache-hit' | 'baseline-fallback';

export interface ScoreImageResult {
  rawScore: number;   // 0..1
  aiRating: number;   // 0..5 (display)
  modelVersion: string;
  imageHash: string;
  source: WebcamSource;
  pathTaken: ScorePath;
}

const cachedSessions = new Map<string, unknown>();
let cachedOrt: unknown | null = null;

export function __resetScoreImageCacheForTests(): void {
  cachedSessions.clear();
  cachedOrt = null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function resolveModelPath(): string {
  const ref =
    process.env.AI_ONNX_REGRESSION_MODEL_PATH?.trim() ||
    AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT;
  return path.isAbsolute(ref) ? ref : path.join(process.cwd(), ref);
}

function resolveModelVersion(): string {
  return (
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ||
    AI_REGRESSION_MODEL_VERSION_DEFAULT
  );
}

async function getOrt(): Promise<unknown> {
  if (cachedOrt) return cachedOrt;
  const moduleName = 'onnxruntime-node';
  cachedOrt = await import(moduleName);
  return cachedOrt;
}

async function getSession(modelPath: string): Promise<unknown> {
  const hit = cachedSessions.get(modelPath);
  if (hit) return hit;
  const ort = (await getOrt()) as {
    InferenceSession: { create: (p: string) => Promise<unknown> };
  };
  const session = await ort.InferenceSession.create(modelPath);
  cachedSessions.set(modelPath, session);
  return session;
}

function baselineRaw(input: ScoreImageInput): number {
  const views = input.fallbackMeta?.viewCount ?? 0;
  const manual = input.fallbackMeta?.manualRating ?? 3;
  const normViews = clamp(Math.log10(views + 1) / 6, 0, 1);
  const normManual = clamp(manual / 5, 0, 1);
  return clamp(normViews * 0.65 + normManual * 0.35, 0, 1);
}

function ratingFromRaw(raw: number): number {
  return Number((raw * 5).toFixed(2));
}

/** Map an ONNX output number to a normalized {rawScore, aiRating} pair. */
function normalizeOnnxOutput(value: number): {
  rawScore: number;
  aiRating: number;
} {
  // Regression model emits a 0..5 rating-space value.
  const aiRating = clamp(value, 0, 5);
  const rawScore = clamp(aiRating / 5, 0, 1);
  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating: Number(aiRating.toFixed(2)),
  };
}

/**
 * Score a single image. Caller is responsible for fetching bytes and
 * for the Redis hash lookup/write — this function is pure on its inputs
 * apart from the ONNX session cache.
 */
export async function scoreImage(
  input: ScoreImageInput
): Promise<ScoreImageResult> {
  const modelVersion = resolveModelVersion();
  const imageHash = sha256Hex(input.imageBytes);

  if (input.lastImageHash && input.lastImageHash === imageHash) {
    return {
      rawScore: 0, // ignored by caller on cache-hit
      aiRating: 0,
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'cache-hit',
    };
  }

  const mode =
    process.env.AI_SCORING_MODE?.trim() || AI_SCORING_MODE_DEFAULT;

  if (mode !== 'onnx') {
    const raw = baselineRaw(input);
    return {
      rawScore: raw,
      aiRating: ratingFromRaw(raw),
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'baseline-fallback',
    };
  }

  try {
    const ort = (await getOrt()) as {
      Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown;
    };
    const session = (await getSession(resolveModelPath())) as {
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const tensorData = await preprocessJpegToImagenetTensor(input.imageBytes);
    const tensor = new ort.Tensor('float32', tensorData, [1, 3, 224, 224]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const raw = outputs[session.outputNames[0]] as { data?: ArrayLike<number> };
    const value = Number(raw?.data?.[0] ?? 2.5);
    const normalized = normalizeOnnxOutput(value);

    return {
      rawScore: normalized.rawScore,
      aiRating: normalized.aiRating,
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'onnx',
    };
  } catch (error) {
    console.warn(
      `[scoreImage] ONNX failed for webcam ${input.webcamId}, falling back:`,
      error
    );
    const raw = baselineRaw(input);
    return {
      rawScore: raw,
      aiRating: ratingFromRaw(raw),
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'baseline-fallback',
    };
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 5 tests pass.

- [ ] **Step 5: Find every existing caller of the old `scoreWebcamPreview`**

Run:
```bash
grep -rn "scoreWebcamPreview\|WebcamAiScore" app/ --include="*.ts" --include="*.tsx"
```

Expected: only `route.ts` in the moved cron. Task 9 rewires it.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/aiScoring.ts app/api/cron/update-cameras/lib/aiScoring.test.ts
git commit -m "feat(scoring): replace metadata bridge with real ONNX image scoring"
```

---

## Task 9: dbOperations.ts — add backfill + daily-stats writers

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts`
- Create: `app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts`

Add three writers needed by the new cron paths. Keep existing functions untouched.

- [ ] **Step 1: Write the failing tests**

Create `app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  findCustomSnapshotsNeedingScore,
  updateSnapshotAiRegressionScore,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
} from './dbOperations';

beforeEach(() => sqlMock.mockReset());

describe('findCustomSnapshotsNeedingScore', () => {
  it('selects snapshots with NULL ai_regression_score for custom-source webcams', async () => {
    sqlMock.mockResolvedValue([
      { snapshot_id: 1, webcam_id: 42, firebase_url: 'https://x/1.jpg' },
    ]);
    const rows = await findCustomSnapshotsNeedingScore(50);
    expect(rows).toEqual([
      { snapshotId: 1, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
    ]);
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/ai_regression_score\s+is\s+null/i);
    expect(q).toMatch(/source\s*=\s*'custom'/i);
    expect(q).toMatch(/limit/i);
  });
});

describe('updateSnapshotAiRegressionScore', () => {
  it('writes ai_regression_score + ai_model_version_regression for a snapshot id', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4');
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_model_version_regression/);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('v4');
  });
});

describe('updateWebcamRegressionScoreFromLatestCustomSnapshot', () => {
  it('copies the latest snapshot score into webcams.ai_rating_regression', async () => {
    sqlMock.mockResolvedValue([]);
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(42);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcams/i);
    expect(q).toMatch(/ai_rating_regression/);
    expect(q).toMatch(/order\s+by\s+captured_at\s+desc/i);
    expect(values).toContain(42);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `app/api/cron/update-cameras/lib/dbOperations.ts`:

```ts
export interface CustomSnapshotNeedingScore {
  snapshotId: number;
  webcamId: number;
  firebaseUrl: string;
}

/**
 * Snapshot rows for source='custom' webcams that still need a server-side
 * regression score. Bounded by `limit` so a backlog can't blow the tick
 * deadline.
 */
export async function findCustomSnapshotsNeedingScore(
  limit: number
): Promise<CustomSnapshotNeedingScore[]> {
  const rows = (await sql`
    select s.id        as snapshot_id,
           s.webcam_id as webcam_id,
           s.firebase_url
    from webcam_snapshots s
    join webcams w on w.id = s.webcam_id
    where w.source = 'custom'
      and s.ai_regression_score is null
      and s.firebase_url is not null
    order by s.captured_at desc
    limit ${limit}
  `) as {
    snapshot_id: number;
    webcam_id: number;
    firebase_url: string;
  }[];

  return rows.map((r) => ({
    snapshotId: r.snapshot_id,
    webcamId: r.webcam_id,
    firebaseUrl: r.firebase_url,
  }));
}

export async function updateSnapshotAiRegressionScore(
  snapshotId: number,
  score: number,
  modelVersion: string
): Promise<void> {
  await sql`
    update webcam_snapshots
    set ai_regression_score = ${score},
        ai_model_version_regression = ${modelVersion}
    where id = ${snapshotId}
  `;
}

/**
 * After scoring custom snapshots, sync the webcam-level score to the latest
 * snapshot's regression score so mosaic tile sizing reflects the most recent
 * captured moment. Single SQL — no read-then-write race.
 */
export async function updateWebcamRegressionScoreFromLatestCustomSnapshot(
  webcamId: number
): Promise<void> {
  await sql`
    update webcams
    set ai_rating_regression = ls.ai_regression_score,
        ai_model_version_regression = ls.ai_model_version_regression,
        updated_at = now()
    from (
      select ai_regression_score, ai_model_version_regression
      from webcam_snapshots
      where webcam_id = ${webcamId}
        and ai_regression_score is not null
      order by captured_at desc
      limit 1
    ) ls
    where id = ${webcamId}
  `;
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 3 new tests pass; old `dbOperations.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/dbOperations.ts app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts
git commit -m "feat(cron): db ops for custom-snapshot backfill + webcam score sync"
```

---

## Task 10: customBackfill.ts — score-and-persist custom snapshots

**Files:**
- Create: `app/api/cron/update-cameras/lib/customBackfill.ts`
- Create: `app/api/cron/update-cameras/lib/customBackfill.test.ts`

Wraps: query null-score snapshots → fetch each blob → score → write `ai_regression_score`/`ai_model_version_regression` → sync `webcams.ai_rating_regression`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMock = vi.fn();
const updateSnapMock = vi.fn();
const syncWebcamMock = vi.fn();
const downloadMock = vi.fn();
const scoreMock = vi.fn();

vi.mock('./dbOperations', () => ({
  findCustomSnapshotsNeedingScore: (...a: unknown[]) => findMock(...a),
  updateSnapshotAiRegressionScore: (...a: unknown[]) => updateSnapMock(...a),
  updateWebcamRegressionScoreFromLatestCustomSnapshot: (...a: unknown[]) =>
    syncWebcamMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
}));
vi.mock('./aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
}));

import { backfillCustomSnapshotScores } from './customBackfill';

beforeEach(() => {
  findMock.mockReset();
  updateSnapMock.mockReset().mockResolvedValue(undefined);
  syncWebcamMock.mockReset().mockResolvedValue(undefined);
  downloadMock.mockReset();
  scoreMock.mockReset();
});

describe('backfillCustomSnapshotScores', () => {
  it('returns zero counts when there are no null-score snapshots', async () => {
    findMock.mockResolvedValue([]);
    const result = await backfillCustomSnapshotScores({ limit: 50 });
    expect(result).toEqual({ scored: 0, failed: 0, modelVersion: null });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(updateSnapMock).not.toHaveBeenCalled();
  });

  it('scores each snapshot and syncs the parent webcam', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
      { snapshotId: 12, webcamId: 42, firebaseUrl: 'https://x/2.jpg' },
    ]);
    downloadMock.mockResolvedValue(Buffer.from('jpg'));
    scoreMock.mockResolvedValue({
      rawScore: 0.82,
      aiRating: 4.1,
      modelVersion: 'v4',
      imageHash: 'h',
      source: 'custom',
      pathTaken: 'onnx',
    });

    const result = await backfillCustomSnapshotScores({ limit: 50 });

    expect(result.scored).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.modelVersion).toBe('v4');
    expect(updateSnapMock).toHaveBeenCalledTimes(2);
    expect(updateSnapMock).toHaveBeenCalledWith(11, 0.82, 'v4');
    expect(updateSnapMock).toHaveBeenCalledWith(12, 0.82, 'v4');
    // Webcam sync runs once per unique webcam_id (42 appears twice -> 1 call).
    expect(syncWebcamMock).toHaveBeenCalledTimes(1);
    expect(syncWebcamMock).toHaveBeenCalledWith(42);
  });

  it('counts a download failure as `failed` and continues with other rows', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
      { snapshotId: 12, webcamId: 43, firebaseUrl: 'https://x/2.jpg' },
    ]);
    downloadMock
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce(Buffer.from('jpg'));
    scoreMock.mockResolvedValue({
      rawScore: 0.5, aiRating: 2.5, modelVersion: 'v4',
      imageHash: 'h', source: 'custom', pathTaken: 'onnx',
    });

    const result = await backfillCustomSnapshotScores({ limit: 50 });

    expect(result.scored).toBe(1);
    expect(result.failed).toBe(1);
    expect(syncWebcamMock).toHaveBeenCalledWith(43);
    expect(syncWebcamMock).not.toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { downloadImage } from '@/app/lib/webcamSnapshot';
import { scoreImage } from './aiScoring';
import {
  findCustomSnapshotsNeedingScore,
  updateSnapshotAiRegressionScore,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
} from './dbOperations';

export interface BackfillResult {
  scored: number;
  failed: number;
  modelVersion: string | null;
  /** Raw 0..1 regression scores for every successfully scored snapshot, in
   *  the order they were processed. Fed into daily_sunset_stats percentiles. */
  scores: number[];
}

/**
 * Score every custom-camera snapshot whose ai_regression_score is still NULL,
 * up to `limit`. Returns counts for daily_sunset_stats. Errors per-row never
 * crash the tick — they're counted as failed.
 */
export async function backfillCustomSnapshotScores(opts: {
  limit: number;
}): Promise<BackfillResult> {
  const rows = await findCustomSnapshotsNeedingScore(opts.limit);
  if (rows.length === 0) {
    return { scored: 0, failed: 0, modelVersion: null, scores: [] };
  }

  let scored = 0;
  let failed = 0;
  let modelVersion: string | null = null;
  const scores: number[] = [];
  const touchedWebcamIds = new Set<number>();

  for (const row of rows) {
    try {
      const bytes = await downloadImage(row.firebaseUrl);
      const result = await scoreImage({
        webcamId: row.webcamId,
        imageBytes: bytes,
        source: 'custom',
      });
      await updateSnapshotAiRegressionScore(
        row.snapshotId,
        result.rawScore,
        result.modelVersion
      );
      modelVersion = result.modelVersion;
      touchedWebcamIds.add(row.webcamId);
      scores.push(result.rawScore);
      scored += 1;
    } catch (error) {
      console.warn(
        `[customBackfill] snapshot ${row.snapshotId} failed:`,
        error
      );
      failed += 1;
    }
  }

  // Per-webcam sync runs once even if multiple of its snapshots were scored.
  for (const webcamId of touchedWebcamIds) {
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(webcamId);
  }

  return { scored, failed, modelVersion, scores };
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 3 tests pass. Update each test's `expect(result)` to include the new `scores: [...]` field — the empty case is `scores: []`, the happy-path two-scored case is `scores: [0.82, 0.82]`, and the partial-failure case is `scores: [0.5]`.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/customBackfill.ts app/api/cron/update-cameras/lib/customBackfill.test.ts
git commit -m "feat(cron): backfill ai_regression_score for custom-camera snapshots"
```

---

## Task 11: dailyStats.ts — per-tick UPSERT

**Files:**
- Create: `app/api/cron/update-cameras/lib/dailyStats.ts`
- Create: `app/api/cron/update-cameras/lib/dailyStats.test.ts`

Aggregates the in-tick scores + counts and UPSERTs them into `daily_sunset_stats` keyed by UTC date. Counters accumulate by ADD across ticks; score percentiles are recomputed from the latest tick's in-memory scores (acceptable approximation — a faithful daily distribution would need a separate sketch). Spec §2.5.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { computeTickStats, upsertDailyStats } from './dailyStats';

beforeEach(() => sqlMock.mockReset());

describe('computeTickStats', () => {
  it('computes count, avg, percentiles, and above-threshold count', () => {
    const scores = [0.1, 0.3, 0.5, 0.6, 0.8, 0.9];
    const stats = computeTickStats({
      windyScores: scores,
      customScores: [],
      cacheHits: 4,
      fallbacks: 1,
      modelVersion: 'v4',
      minScoreToWin: 0.5,
    });
    expect(stats.modelVersion).toBe('v4');
    expect(stats.webcamsScored).toBe(6);
    expect(stats.cacheHits).toBe(4);
    expect(stats.fallbacks).toBe(1);
    expect(stats.scoreAvg).toBeCloseTo(0.5333, 3);
    expect(stats.scoreP50).toBeGreaterThanOrEqual(0.5);
    expect(stats.scoreP50).toBeLessThanOrEqual(0.6);
    expect(stats.aboveMinScoreToWinCount).toBe(4); // 0.5, 0.6, 0.8, 0.9
    expect(stats.sourceBreakdown).toEqual({
      windy: { scored: 6, avg: expect.any(Number) },
      custom: { scored: 0, avg: null },
    });
  });

  it('handles empty score arrays', () => {
    const stats = computeTickStats({
      windyScores: [],
      customScores: [],
      cacheHits: 10,
      fallbacks: 0,
      modelVersion: 'v4',
      minScoreToWin: 0.5,
    });
    expect(stats.webcamsScored).toBe(0);
    expect(stats.scoreAvg).toBeNull();
    expect(stats.scoreP50).toBeNull();
  });
});

describe('upsertDailyStats', () => {
  it('UPSERTs into daily_sunset_stats by UTC date PK', async () => {
    sqlMock.mockResolvedValue([]);
    await upsertDailyStats(new Date('2026-05-15T12:34:56Z'), {
      modelVersion: 'v4',
      webcamsScored: 100,
      cacheHits: 70,
      fallbacks: 2,
      scoreAvg: 0.5,
      scoreP50: 0.5,
      scoreP90: 0.8,
      scoreP99: 0.95,
      aboveMinScoreToWinCount: 30,
      sourceBreakdown: { windy: { scored: 98, avg: 0.5 }, custom: { scored: 2, avg: 0.7 } },
    });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/insert\s+into\s+daily_sunset_stats/i);
    expect(q).toMatch(/on\s+conflict\s*\(\s*date\s*\)/i);
    // The UTC date should be in the values, formatted as YYYY-MM-DD.
    expect(values).toContain('2026-05-15');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { sql } from '@/app/lib/db';

export interface TickStats {
  modelVersion: string;
  webcamsScored: number;
  cacheHits: number;
  fallbacks: number;
  scoreAvg: number | null;
  scoreP50: number | null;
  scoreP90: number | null;
  scoreP99: number | null;
  aboveMinScoreToWinCount: number;
  sourceBreakdown: {
    windy: { scored: number; avg: number | null };
    custom: { scored: number; avg: number | null };
  };
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Number(
    (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(3)
  );
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length))
  );
  return Number(sorted[idx].toFixed(3));
}

export function computeTickStats(input: {
  windyScores: number[];
  customScores: number[];
  cacheHits: number;
  fallbacks: number;
  modelVersion: string;
  minScoreToWin: number;
}): TickStats {
  const all = [...input.windyScores, ...input.customScores];
  return {
    modelVersion: input.modelVersion,
    webcamsScored: all.length,
    cacheHits: input.cacheHits,
    fallbacks: input.fallbacks,
    scoreAvg: avg(all),
    scoreP50: percentile(all, 50),
    scoreP90: percentile(all, 90),
    scoreP99: percentile(all, 99),
    aboveMinScoreToWinCount: all.filter((s) => s >= input.minScoreToWin)
      .length,
    sourceBreakdown: {
      windy: {
        scored: input.windyScores.length,
        avg: avg(input.windyScores),
      },
      custom: {
        scored: input.customScores.length,
        avg: avg(input.customScores),
      },
    },
  };
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * UPSERT today's row in daily_sunset_stats. Counters ADD across ticks so an
 * intra-day rerun is additive; percentile/avg columns OVERWRITE with the
 * most recent tick's values (cheap, approximate, sufficient for tuning).
 */
export async function upsertDailyStats(
  now: Date,
  stats: TickStats
): Promise<void> {
  const date = utcDateString(now);
  await sql`
    insert into daily_sunset_stats (
      date, model_version,
      webcams_scored, cache_hits, fallbacks,
      score_avg, score_p50, score_p90, score_p99,
      above_min_score_to_win_count, source_breakdown,
      updated_at
    ) values (
      ${date}, ${stats.modelVersion},
      ${stats.webcamsScored}, ${stats.cacheHits}, ${stats.fallbacks},
      ${stats.scoreAvg}, ${stats.scoreP50}, ${stats.scoreP90}, ${stats.scoreP99},
      ${stats.aboveMinScoreToWinCount}, ${JSON.stringify(stats.sourceBreakdown)}::jsonb,
      now()
    )
    on conflict (date) do update set
      model_version = excluded.model_version,
      webcams_scored = daily_sunset_stats.webcams_scored + excluded.webcams_scored,
      cache_hits = daily_sunset_stats.cache_hits + excluded.cache_hits,
      fallbacks = daily_sunset_stats.fallbacks + excluded.fallbacks,
      score_avg = excluded.score_avg,
      score_p50 = excluded.score_p50,
      score_p90 = excluded.score_p90,
      score_p99 = excluded.score_p99,
      above_min_score_to_win_count =
        daily_sunset_stats.above_min_score_to_win_count
        + excluded.above_min_score_to_win_count,
      source_breakdown = excluded.source_breakdown,
      updated_at = now()
  `;
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/dailyStats.ts app/api/cron/update-cameras/lib/dailyStats.test.ts
git commit -m "feat(cron): per-tick daily_sunset_stats aggregator + UPSERT"
```

---

## Task 12: Wire route.ts — replace metadata bridge with image scoring + hash cache

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts`

The existing per-webcam loop calls `scoreWebcamPreview` (metadata bridge) and captures snapshots when raw-score crosses a threshold. Replace with:

1. For each Windy webcam: fetch preview bytes → check Redis hash → call `scoreImage` → if not a cache hit, write the new hash and update `webcams.ai_rating_regression`. Drop snapshot capture inside the Windy loop entirely — the spec is explicit that Windy rows score the preview into the webcam column only; snapshot inserts happen elsewhere.
2. Track per-tick counts: cacheHits, fallbacks, windyScores, customScores.
3. After Windy loop, call `backfillCustomSnapshotScores`.
4. At the very end (after terminator-state writes + cache warm), call `upsertDailyStats`.

Concurrency: process Windy webcams in batches of 10 (`Promise.all` per batch). Per-image fetch+inference timeout: 3000 ms. Soft tick deadline: 50000 ms — stop starting new batches past it.

Drop these from the old route: `findRecentSnapshot`, `captureWebcamSnapshot`, `insertSnapshotRecord`, `upsertSnapshotAiInference` calls for Windy, plus the legacy `aiStats.snapshots_captured` etc.

- [ ] **Step 1: Skim the existing route.ts**

Run: `git show HEAD:app/api/cron/update-cameras/route.ts | wc -l` — confirm the file is the ~280-line version. Open it and read top to bottom.

- [ ] **Step 2: Write an integration test for the new orchestration**

Create `app/api/cron/update-cameras/route.test.ts` (or extend any existing one):

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchTerminatorWebcamsMock = vi.fn();
const setCachedMock = vi.fn();
const fetchBatchesMock = vi.fn();
const upsertWebcamsMock = vi.fn();
const classifyMock = vi.fn();
const getIdMapMock = vi.fn();
const upsertStateMock = vi.fn();
const deactivateMock = vi.fn();
const updateAiFieldsMock = vi.fn();
const downloadMock = vi.fn();
const scoreMock = vi.fn();
const getHashMock = vi.fn();
const setHashMock = vi.fn();
const backfillMock = vi.fn();
const upsertStatsMock = vi.fn();
const verifyAuthMock = vi.fn(() => true);

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: () => fetchTerminatorWebcamsMock(),
}));
vi.mock('@/app/lib/cache', () => ({
  setCachedTerminatorPayload: (...a: unknown[]) => setCachedMock(...a),
  getCameraImageHash: (...a: unknown[]) => getHashMock(...a),
  setCameraImageHash: (...a: unknown[]) => setHashMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
}));
vi.mock('./lib/auth', () => ({ verifyCronAuth: () => verifyAuthMock() }));
vi.mock('./lib/windyApi', () => ({
  dedupeCoords: (x: unknown) => x,
  dedupeWebcams: () => new Map(),
  fetchWebcamsInBatches: (...a: unknown[]) => fetchBatchesMock(...a),
}));
vi.mock('./lib/webcamClassification', () => ({
  classifyWebcamsByPhase: (...a: unknown[]) => classifyMock(...a),
}));
vi.mock('./lib/dbOperations', () => ({
  upsertWebcams: (...a: unknown[]) => upsertWebcamsMock(...a),
  getWebcamIdMap: (...a: unknown[]) => getIdMapMock(...a),
  upsertTerminatorState: (...a: unknown[]) => upsertStateMock(...a),
  deactivateMissingTerminatorState: (...a: unknown[]) => deactivateMock(...a),
  updateWebcamAiFields: (...a: unknown[]) => updateAiFieldsMock(...a),
}));
vi.mock('./lib/aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
}));
vi.mock('./lib/customBackfill', () => ({
  backfillCustomSnapshotScores: (...a: unknown[]) => backfillMock(...a),
}));
vi.mock('./lib/dailyStats', () => ({
  computeTickStats: vi.fn(() => ({ modelVersion: 'v4', webcamsScored: 1, cacheHits: 0, fallbacks: 0, scoreAvg: 0.5, scoreP50: 0.5, scoreP90: 0.5, scoreP99: 0.5, aboveMinScoreToWinCount: 0, sourceBreakdown: { windy: { scored: 1, avg: 0.5 }, custom: { scored: 0, avg: null } } })),
  upsertDailyStats: (...a: unknown[]) => upsertStatsMock(...a),
}));
vi.mock('@/app/components/Map/lib/subsolarLocation', () => ({
  subsolarPoint: () => ({ raHours: 0, gmstHours: 0 }),
}));
vi.mock('@/app/components/Map/lib/terminatorRing', () => ({
  createTerminatorQueryRing: () => ({ sunriseCoords: [], sunsetCoords: [] }),
}));

import { GET } from './route';

beforeEach(() => {
  fetchBatchesMock.mockReset().mockResolvedValue([[{
    webcamId: 7, location: { latitude: 0, longitude: 0 },
    images: { current: { preview: 'https://x/p.jpg' } },
    viewCount: 1, rating: 3,
  }]]);
  classifyMock.mockReset().mockReturnValue({ sunrise: [], sunset: [] });
  getIdMapMock.mockReset().mockResolvedValue(new Map([['7', 700]]));
  upsertWebcamsMock.mockReset().mockResolvedValue(undefined);
  upsertStateMock.mockReset().mockResolvedValue(undefined);
  deactivateMock.mockReset().mockResolvedValue(undefined);
  updateAiFieldsMock.mockReset().mockResolvedValue(undefined);
  downloadMock.mockReset().mockResolvedValue(Buffer.from('jpg'));
  getHashMock.mockReset().mockResolvedValue(null);
  setHashMock.mockReset().mockResolvedValue(undefined);
  scoreMock.mockReset().mockResolvedValue({
    rawScore: 0.6, aiRating: 3.0, modelVersion: 'v4',
    imageHash: 'newhash', source: 'windy', pathTaken: 'onnx',
  });
  backfillMock.mockReset().mockResolvedValue({ scored: 0, failed: 0, modelVersion: null });
  upsertStatsMock.mockReset().mockResolvedValue(undefined);
  setCachedMock.mockReset().mockResolvedValue(undefined);
  fetchTerminatorWebcamsMock.mockReset().mockResolvedValue([]);
});

function makeReq(): Request {
  return new Request('http://test/api/cron/update-cameras');
}

describe('GET /api/cron/update-cameras', () => {
  it('scores a Windy webcam via scoreImage and writes the new hash', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(scoreMock).toHaveBeenCalledTimes(1);
    expect(setHashMock).toHaveBeenCalledWith('windy', 700, 'newhash');
    expect(updateAiFieldsMock).toHaveBeenCalledTimes(1);
  });

  it('skips Neon writes when the image hash matches Redis', async () => {
    getHashMock.mockResolvedValueOnce('newhash');
    scoreMock.mockResolvedValueOnce({
      rawScore: 0, aiRating: 0, modelVersion: 'v4',
      imageHash: 'newhash', source: 'windy', pathTaken: 'cache-hit',
    });
    await GET(makeReq());
    expect(updateAiFieldsMock).not.toHaveBeenCalled();
    expect(setHashMock).not.toHaveBeenCalled();
  });

  it('calls the custom-snapshot backfill once per tick', async () => {
    await GET(makeReq());
    expect(backfillMock).toHaveBeenCalledTimes(1);
  });

  it('UPSERTs daily_sunset_stats at end of tick', async () => {
    await GET(makeReq());
    expect(upsertStatsMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Expected: tests reference functions/exports that don't exist yet in `route.ts`.

- [ ] **Step 4: Rewrite route.ts**

Open `app/api/cron/update-cameras/route.ts`. Apply these changes:

- Replace the `import { scoreWebcamPreview } from './lib/aiScoring'` with:

```ts
import { scoreImage } from './lib/aiScoring';
import { backfillCustomSnapshotScores } from './lib/customBackfill';
import { computeTickStats, upsertDailyStats } from './lib/dailyStats';
import { downloadImage } from '@/app/lib/webcamSnapshot';
import {
  getCameraImageHash,
  setCameraImageHash,
  setCachedTerminatorPayload,
} from '@/app/lib/cache';
```

(Note: `daily_sunset_stats.above_min_score_to_win_count` needs a threshold. Use the literal `0.5` inline for Phase 1; Task 14 introduces `WINNER_POLICY_WINDY_MIN_SCORE_TO_WIN` and swaps the literal for the constant. Don't import the constant here — it doesn't exist until Phase 2.)

- Drop the imports of `findRecentSnapshot`, `insertSnapshotRecord`, `upsertSnapshotAiInference`, `captureWebcamSnapshot`, and `AI_SNAPSHOT_*` constants — those snapshot-capture-during-windy-tick paths are removed.

- Replace the per-webcam loop body with:

```ts
const TICK_DEADLINE_MS = 50_000;
const PER_IMAGE_TIMEOUT_MS = 3_000;
const WINDY_BATCH_SIZE = 10;

const tickStartedAt = Date.now();
const windyScores: number[] = [];
let cacheHits = 0;
let fallbacks = 0;

async function scoreOneWindy(webcam: typeof windyAll[number]): Promise<void> {
  const externalId = String(webcam.webcamId);
  const webcamId = idByExternal.get(externalId);
  if (!webcamId) return;

  const previewUrl = webcam.images?.current?.preview;
  if (!previewUrl) return;

  try {
    const bytes = await Promise.race([
      downloadImage(previewUrl),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('image fetch timeout')), PER_IMAGE_TIMEOUT_MS)
      ),
    ]);
    const lastHash = await getCameraImageHash('windy', webcamId);
    const scored = await scoreImage({
      webcamId,
      imageBytes: bytes,
      source: 'windy',
      lastImageHash: lastHash ?? undefined,
      fallbackMeta: {
        viewCount: webcam.viewCount,
        manualRating: webcam.rating ?? undefined,
      },
    });

    if (scored.pathTaken === 'cache-hit') {
      cacheHits += 1;
      return;
    }
    if (scored.pathTaken === 'baseline-fallback') fallbacks += 1;
    windyScores.push(scored.rawScore);

    await setCameraImageHash('windy', webcamId, scored.imageHash);
    await updateWebcamAiFields([
      {
        webcamId,
        aiRating: scored.aiRating,
        aiModelVersion: scored.modelVersion,
        aiRatingBinary: scored.aiRating, // binary scoring not in Phase 1
        aiModelVersionBinary: scored.modelVersion,
        aiRatingRegression: scored.aiRating,
        aiModelVersionRegression: scored.modelVersion,
      },
    ]);
  } catch (error) {
    console.warn(
      `[update-cameras] windy webcam ${webcam.webcamId} scoring failed:`,
      error
    );
    fallbacks += 1;
  }
}

for (let i = 0; i < windyAll.length; i += WINDY_BATCH_SIZE) {
  if (Date.now() - tickStartedAt > TICK_DEADLINE_MS) {
    console.warn('[update-cameras] tick deadline reached, stopping batches');
    break;
  }
  const batch = windyAll.slice(i, i + WINDY_BATCH_SIZE);
  await Promise.all(batch.map(scoreOneWindy));
}

// Custom-camera score backfill — bounded by the same tick deadline.
const remainingBudget = Math.max(
  10,
  TICK_DEADLINE_MS - (Date.now() - tickStartedAt)
);
const backfillResult = await backfillCustomSnapshotScores({
  limit: Math.min(50, Math.floor(remainingBudget / 100)),
});
```

- After the existing terminator-state writes and `setCachedTerminatorPayload`, append:

```ts
const tickStats = computeTickStats({
  windyScores,
  customScores: backfillResult.scores,
  cacheHits,
  fallbacks: fallbacks + backfillResult.failed,
  modelVersion:
    backfillResult.modelVersion ??
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ??
    'unknown',
  // 0.5 matches the device-protocol §9.4.2 default. Task 14 replaces this
  // literal with WINNER_POLICY_WINDY_MIN_SCORE_TO_WIN once Phase 2 lands.
  minScoreToWin: 0.5,
});
try {
  await upsertDailyStats(new Date(), tickStats);
} catch (err) {
  console.error('[update-cameras] daily_sunset_stats UPSERT failed:', err);
}
```

(Note: the `customScores` placeholder is a known-coarse approximation — Phase 2 may revisit if per-score telemetry is needed.)

- [ ] **Step 5: Run, confirm pass**

Expected: 4 route tests pass; old tests still pass.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(cron): real-image scoring + Redis hash cache + custom backfill + daily stats"
```

---

## Task 13: Manual verification before Phase 2

**Files:** (no code changes)

- [ ] **Step 1: Set env vars on Vercel preview deploy**

In the Vercel dashboard for this branch's preview:
- `AI_SCORING_MODE=onnx`
- `AI_REGRESSION_MODEL_VERSION=v4-resnet18-2026-03`  (or whatever your real artifact is named)
- `AI_ONNX_REGRESSION_MODEL_PATH=ml/artifacts/models/regression_resnet18/20260315_003913_v2_regression_mild_crop/model.onnx`  (path relative to repo root)

- [ ] **Step 2: Trigger the cron manually**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<preview-url>/api/cron/update-cameras | jq .
```

Expected: HTTP 200, JSON `{ok: true, sunrise: <n>, sunset: <n>, ai: {...}}`.

- [ ] **Step 3: Inspect daily_sunset_stats**

```bash
psql "$DATABASE_URL" -c "SELECT date, model_version, webcams_scored, cache_hits, fallbacks, score_avg, score_p50, score_p90, source_breakdown FROM daily_sunset_stats ORDER BY date DESC LIMIT 3;"
```

Expected: at least one row for today's UTC date with `webcams_scored > 0` and `score_p50` populated. `fallbacks` should be a small fraction of `webcams_scored` — if it equals `webcams_scored`, ONNX is failing every call (check Vercel logs).

- [ ] **Step 4: Spot-check 5–10 webcams**

```bash
psql "$DATABASE_URL" -c "
SELECT w.id, w.title, w.ai_rating_regression, w.ai_model_version_regression
FROM webcams w
JOIN terminator_webcam_state s ON s.webcam_id = w.id
WHERE s.active = true AND s.phase = 'sunset'
ORDER BY w.ai_rating_regression DESC NULLS LAST
LIMIT 10;
"
```

Pull up each row's preview image (use the existing `/api/db-terminator-webcams` payload or `webcams.images->'current'->>'preview'`) and eyeball whether the score feels plausible. Pearson r=0.90 doesn't guarantee per-image plausibility; this is the human sanity check.

- [ ] **Step 5: Confirm Redis cache hit rate**

After two consecutive cron ticks, expect `daily_sunset_stats.cache_hits / webcams_scored` to climb past 60%. If it's stuck near zero, the hash isn't being written or read — check Upstash dashboard for `camera:hash:*` keys.

- [ ] **Step 6: Confirm deprecated route still works**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<preview-url>/api/cron/update-windy -o /dev/null -w "%{http_code}\n"
```

Expected: `200`. (Should behave identically — it's a re-export.)

- [ ] **Step 7: Tag the commit hash and let Phase 1 bake**

```bash
git log --oneline -1
```

Note the SHA. Phase 1 ships here. **Do not start Phase 2 until daily_sunset_stats has ~7 days of data** — its score distribution is what Phase 2's thresholds tune against.

---

# Phase 2 — Winner selection + global cap

Phase 2 starts after ~7 days of Phase 1 data. Pull observed `score_p80`, `score_p90`, and `above_min_score_to_win_count` from `daily_sunset_stats` first — those tune the `MIN_SCORE_TO_WIN` and `DAILY_WINNER_GLOBAL_CAP` constants in Task 14.

## Task 14: WINNER_POLICY + CAP constants in masterConfig.ts

**Files:**
- Modify: `app/lib/masterConfig.ts`
- Modify: `app/lib/masterConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `app/lib/masterConfig.test.ts`:

```ts
import {
  WINNER_POLICY_CUSTOM,
  WINNER_POLICY_WINDY,
  DAILY_WINNER_GLOBAL_CAP,
  LOSER_RETENTION_DAYS,
} from './masterConfig';

describe('winner policy constants', () => {
  it('WINNER_POLICY_CUSTOM has 0.3+0.7 weights and a min score', () => {
    expect(WINNER_POLICY_CUSTOM.EDGE_WEIGHT).toBeCloseTo(0.3);
    expect(WINNER_POLICY_CUSTOM.AI_WEIGHT).toBeCloseTo(0.7);
    expect(WINNER_POLICY_CUSTOM.MIN_SCORE_TO_WIN).toBeGreaterThan(0);
    expect(WINNER_POLICY_CUSTOM.MIN_SCORE_TO_WIN).toBeLessThanOrEqual(1);
    expect(WINNER_POLICY_CUSTOM.WINDOW_CLOSE_GRACE_S).toBe(300);
  });

  it('WINNER_POLICY_WINDY weights AI alone and uses a rolling window', () => {
    expect(WINNER_POLICY_WINDY.AI_WEIGHT).toBe(1);
    expect(WINNER_POLICY_WINDY.MIN_SCORE_TO_WIN).toBeGreaterThan(0);
    expect(WINNER_POLICY_WINDY.MIN_SCORE_TO_WIN).toBeLessThanOrEqual(1);
    expect(WINNER_POLICY_WINDY.ROLLING_WINDOW_MIN).toBe(90);
  });

  it('DAILY_WINNER_GLOBAL_CAP is in the 50–200 range', () => {
    expect(DAILY_WINNER_GLOBAL_CAP).toBeGreaterThanOrEqual(50);
    expect(DAILY_WINNER_GLOBAL_CAP).toBeLessThanOrEqual(200);
  });

  it('LOSER_RETENTION_DAYS is positive', () => {
    expect(LOSER_RETENTION_DAYS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — constants not exported.

- [ ] **Step 3: Add constants**

Append to `app/lib/masterConfig.ts`:

```ts
// ---------------------------------------------------------------------------
// Winner-selection policies (device-protocol §9.4)
// ---------------------------------------------------------------------------
// Per-source policies live in code, not in env vars, because they're tuned
// from observed daily_sunset_stats distribution and want to be diffed in PRs.
// Tune MIN_SCORE_TO_WIN values from p80–p90 of the daily distribution after
// ~a week of Phase 1 data.
export const WINNER_POLICY_CUSTOM = {
  EDGE_WEIGHT: 0.3,
  AI_WEIGHT: 0.7,
  MIN_SCORE_TO_WIN: 0.4,
  WINDOW_CLOSE_GRACE_S: 300,
} as const;

export const WINNER_POLICY_WINDY = {
  AI_WEIGHT: 1.0,
  MIN_SCORE_TO_WIN: 0.5,
  ROLLING_WINDOW_MIN: 90,
} as const;

// Convenience re-export so route.ts can use a single number for daily-stats
// thresholding without pulling the whole policy object.
export const WINNER_POLICY_WINDY_MIN_SCORE_TO_WIN =
  WINNER_POLICY_WINDY.MIN_SCORE_TO_WIN;

// Global daily winner cap (spec §3.2): start mid-range, willing to raise on
// great-sunset days. Drives end-of-day cleanup; doesn't gate per-tick writes.
export const DAILY_WINNER_GLOBAL_CAP = 100;

// How long to keep is_window_winner=false rows around (DB row stays — only
// the Firebase blob is deleted). Tune up if Firebase usage allows.
export const LOSER_RETENTION_DAYS = 7;
```

- [ ] **Step 4: Update route.ts to use the constant**

Find the `minScoreToWin: 0.5` in `app/api/cron/update-cameras/route.ts` (Task 12's placeholder) and replace with `minScoreToWin: WINNER_POLICY_WINDY_MIN_SCORE_TO_WIN`. Add the import.

- [ ] **Step 5: Run, confirm pass**

Run: `npm test -- --run app/lib/masterConfig.test.ts app/api/cron/update-cameras/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts app/api/cron/update-cameras/route.ts
git commit -m "feat(config): WINNER_POLICY + DAILY_WINNER_GLOBAL_CAP + LOSER_RETENTION_DAYS"
```

---

## Task 15: Phase 2 schema migration (partial index)

**Files:**
- Create: `database/migrations/20260516_model_mosaic_phase2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 2 of the model-mosaic integration. The ai_regression_score column
-- itself shipped in 20260515_model_mosaic_phase1.sql; this migration only
-- adds the partial index that supports the Windy rolling-window winner
-- query: "latest scored snapshot per webcam_id".
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260516_model_mosaic_phase2.sql

CREATE INDEX IF NOT EXISTS webcam_snapshots_ai_regression_idx
  ON webcam_snapshots (webcam_id, captured_at DESC)
  WHERE ai_regression_score IS NOT NULL;
```

- [ ] **Step 2: Apply + verify**

```bash
psql "$DATABASE_URL" -f database/migrations/20260516_model_mosaic_phase2.sql
psql "$DATABASE_URL" -c "\d webcam_snapshots" | grep -i ai_regression_idx
```

Expected: the partial index appears.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260516_model_mosaic_phase2.sql
git commit -m "db: add webcam_snapshots_ai_regression_idx for winner selection"
```

---

## Task 16: winnerSelection.ts — pickCustomWindowWinners

**Files:**
- Create: `app/api/cron/update-cameras/lib/winnerSelection.ts`
- Create: `app/api/cron/update-cameras/lib/winnerSelection.test.ts`

Spec §3.1 custom-camera path. Window-close trigger: `cameras.last_heartbeat_at < now() - WINDOW_CLOSE_GRACE_S` AND no new snapshot rows for that `window_id` in the grace period. Score formula: `edge_score * EDGE_WEIGHT + ai_regression_score * AI_WEIGHT`. Argmax wins; below `MIN_SCORE_TO_WIN` means no winner.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { pickCustomWindowWinners } from './winnerSelection';

beforeEach(() => sqlMock.mockReset());

describe('pickCustomWindowWinners', () => {
  it('picks the argmax of edge*0.3 + ai*0.7 per closed window_id', async () => {
    // 1st call: list of closed windows. 2nd+: per-window snapshots.
    sqlMock
      .mockResolvedValueOnce([
        { window_id: '2026-05-22-sunset-cam42' },
      ])
      .mockResolvedValueOnce([
        { id: 100, edge_score: 0.9, ai_regression_score: 0.4 }, // 0.9*.3 + 0.4*.7 = 0.55
        { id: 101, edge_score: 0.5, ai_regression_score: 0.9 }, // 0.5*.3 + 0.9*.7 = 0.78 ← winner
        { id: 102, edge_score: 0.6, ai_regression_score: 0.5 }, // 0.18 + 0.35 = 0.53
      ])
      .mockResolvedValueOnce([]); // the UPDATE

    const result = await pickCustomWindowWinners(new Date('2026-05-22T03:00:00Z'));
    expect(result.windowsClosed).toBe(1);
    expect(result.winnersPicked).toBe(1);
    expect(result.noWinnerWindows).toBe(0);

    // The UPDATE call should target snapshot id 101.
    const updateCall = sqlMock.mock.calls.at(-1)!;
    const [, ...vals] = updateCall;
    expect(vals).toContain(101);
  });

  it('marks the window as no-winner when max(score) < MIN_SCORE_TO_WIN', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { window_id: '2026-05-22-sunset-cam99' },
      ])
      .mockResolvedValueOnce([
        { id: 200, edge_score: 0.1, ai_regression_score: 0.2 }, // 0.03+0.14 = 0.17
        { id: 201, edge_score: 0.2, ai_regression_score: 0.3 }, // 0.06+0.21 = 0.27
      ]);
      // No UPDATE for sub-threshold windows.

    const result = await pickCustomWindowWinners(new Date());
    expect(result.windowsClosed).toBe(1);
    expect(result.winnersPicked).toBe(0);
    expect(result.noWinnerWindows).toBe(1);
  });

  it('returns zeros when no windows are closed', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const result = await pickCustomWindowWinners(new Date());
    expect(result).toEqual({
      windowsClosed: 0,
      winnersPicked: 0,
      noWinnerWindows: 0,
    });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { sql } from '@/app/lib/db';
import {
  WINNER_POLICY_CUSTOM,
  WINNER_POLICY_WINDY,
} from '@/app/lib/masterConfig';

export interface CustomWinnerResult {
  windowsClosed: number;
  winnersPicked: number;
  noWinnerWindows: number;
}

interface SnapshotForScoring {
  id: number;
  edge_score: number | null;
  ai_regression_score: number | null;
}

/**
 * Window-close trigger: a window_id is "closed" if the most recent snapshot
 * for it is older than WINDOW_CLOSE_GRACE_S AND the snapshot row has no
 * winner flag set yet. We don't need to inspect cameras.last_heartbeat_at
 * directly — "no new snapshots in 5 min for this window_id" is the same
 * signal expressed on the snapshot table itself.
 */
export async function pickCustomWindowWinners(
  now: Date
): Promise<CustomWinnerResult> {
  const graceCutoff = new Date(
    now.getTime() - WINNER_POLICY_CUSTOM.WINDOW_CLOSE_GRACE_S * 1000
  );

  const closed = (await sql`
    select distinct s.window_id
    from webcam_snapshots s
    join webcams w on w.id = s.webcam_id
    where w.source = 'custom'
      and s.window_id is not null
      and not exists (
        select 1 from webcam_snapshots s2
        where s2.window_id = s.window_id
          and s2.is_window_winner = true
      )
      and (
        select max(captured_at) from webcam_snapshots s3
        where s3.window_id = s.window_id
      ) < ${graceCutoff.toISOString()}
  `) as { window_id: string }[];

  let winnersPicked = 0;
  let noWinnerWindows = 0;

  for (const { window_id } of closed) {
    const rows = (await sql`
      select id, edge_score, ai_regression_score
      from webcam_snapshots
      where window_id = ${window_id}
        and ai_regression_score is not null
    `) as SnapshotForScoring[];

    if (rows.length === 0) {
      noWinnerWindows += 1;
      continue;
    }

    let bestId = -1;
    let bestScore = -Infinity;
    for (const row of rows) {
      const edge = Number(row.edge_score ?? 0);
      const ai = Number(row.ai_regression_score ?? 0);
      const score =
        edge * WINNER_POLICY_CUSTOM.EDGE_WEIGHT +
        ai * WINNER_POLICY_CUSTOM.AI_WEIGHT;
      if (score > bestScore) {
        bestScore = score;
        bestId = row.id;
      }
    }

    if (bestScore < WINNER_POLICY_CUSTOM.MIN_SCORE_TO_WIN) {
      noWinnerWindows += 1;
      continue;
    }

    await sql`
      update webcam_snapshots
      set is_window_winner = true
      where id = ${bestId}
    `;
    winnersPicked += 1;
  }

  return {
    windowsClosed: closed.length,
    winnersPicked,
    noWinnerWindows,
  };
}

export interface WindyWinnerResult {
  webcamsConsidered: number;
  winnersPromoted: number;
  winnersDemoted: number;
}

/**
 * Spec §3.1 Windy path. For each Windy webcam that has scored snapshots in
 * the last ROLLING_WINDOW_MIN minutes, the highest-scoring one wins. Any
 * older `is_window_winner=true` rows for the same webcam are demoted.
 */
export async function pickWindyRollingWinners(
  now: Date
): Promise<WindyWinnerResult> {
  const windowStart = new Date(
    now.getTime() - WINNER_POLICY_WINDY.ROLLING_WINDOW_MIN * 60 * 1000
  );

  const candidates = (await sql`
    select s.webcam_id,
           (array_agg(s.id order by s.ai_regression_score desc nulls last))[1] as top_id,
           max(s.ai_regression_score) as top_score
    from webcam_snapshots s
    join webcams w on w.id = s.webcam_id
    where w.source = 'windy'
      and s.captured_at > ${windowStart.toISOString()}
      and s.ai_regression_score is not null
    group by s.webcam_id
  `) as {
    webcam_id: number;
    top_id: number;
    top_score: number | string;
  }[];

  let winnersPromoted = 0;
  let winnersDemoted = 0;

  for (const cand of candidates) {
    const topScore = Number(cand.top_score);
    if (topScore < WINNER_POLICY_WINDY.MIN_SCORE_TO_WIN) continue;

    // Demote any other current winners for this webcam, in the same statement.
    const demote = (await sql`
      update webcam_snapshots
      set is_window_winner = false
      where webcam_id = ${cand.webcam_id}
        and is_window_winner = true
        and id <> ${cand.top_id}
      returning id
    `) as { id: number }[];
    winnersDemoted += demote.length;

    const promote = (await sql`
      update webcam_snapshots
      set is_window_winner = true
      where id = ${cand.top_id}
        and is_window_winner = false
      returning id
    `) as { id: number }[];
    winnersPromoted += promote.length;
  }

  return {
    webcamsConsidered: candidates.length,
    winnersPromoted,
    winnersDemoted,
  };
}
```

- [ ] **Step 4: Add Windy winner-selection tests**

Append to `winnerSelection.test.ts`:

```ts
import { pickWindyRollingWinners } from './winnerSelection';

describe('pickWindyRollingWinners', () => {
  beforeEach(() => sqlMock.mockReset());

  it('promotes the rolling-window argmax and demotes prior winners', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { webcam_id: 700, top_id: 5005, top_score: 0.82 },
      ])
      .mockResolvedValueOnce([{ id: 4400 }]) // demote
      .mockResolvedValueOnce([{ id: 5005 }]); // promote

    const result = await pickWindyRollingWinners(new Date());
    expect(result.webcamsConsidered).toBe(1);
    expect(result.winnersPromoted).toBe(1);
    expect(result.winnersDemoted).toBe(1);
  });

  it('skips webcams whose top score is below MIN_SCORE_TO_WIN', async () => {
    sqlMock.mockResolvedValueOnce([
      { webcam_id: 701, top_id: 5006, top_score: 0.1 },
    ]);
    const result = await pickWindyRollingWinners(new Date());
    expect(result.winnersPromoted).toBe(0);
    expect(result.winnersDemoted).toBe(0);
  });
});
```

- [ ] **Step 5: Run, confirm pass**

Run: `npm test -- --run app/api/cron/update-cameras/lib/winnerSelection.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/winnerSelection.ts app/api/cron/update-cameras/lib/winnerSelection.test.ts
git commit -m "feat(cron): per-source winner selection (custom window + windy rolling)"
```

---

## Task 17: Wire route.ts to call winner selection

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts`
- Modify: `app/api/cron/update-cameras/route.test.ts`

- [ ] **Step 1: Add a failing test**

In `route.test.ts`, add:

```ts
const pickCustomMock = vi.fn();
const pickWindyMock = vi.fn();

vi.mock('./lib/winnerSelection', () => ({
  pickCustomWindowWinners: (...a: unknown[]) => pickCustomMock(...a),
  pickWindyRollingWinners: (...a: unknown[]) => pickWindyMock(...a),
}));

// inside beforeEach:
pickCustomMock.mockReset().mockResolvedValue({
  windowsClosed: 0, winnersPicked: 0, noWinnerWindows: 0,
});
pickWindyMock.mockReset().mockResolvedValue({
  webcamsConsidered: 0, winnersPromoted: 0, winnersDemoted: 0,
});

it('runs winner selection at end of tick', async () => {
  await GET(makeReq());
  expect(pickCustomMock).toHaveBeenCalledTimes(1);
  expect(pickWindyMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — winner selection not yet called from route.

- [ ] **Step 3: Wire route.ts**

Open `app/api/cron/update-cameras/route.ts`. Just before the `upsertDailyStats` call, add:

```ts
import {
  pickCustomWindowWinners,
  pickWindyRollingWinners,
} from './lib/winnerSelection';
// ...
const tickNow = new Date();
const customWinners = await pickCustomWindowWinners(tickNow);
const windyWinners = await pickWindyRollingWinners(tickNow);
console.log('[update-cameras] winners:', {
  custom: customWinners,
  windy: windyWinners,
});
```

Forward `customWinners` + `windyWinners` into the JSON response too, for ease of operator inspection.

- [ ] **Step 4: Run, confirm pass**

Expected: route tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(cron): call winner selection at end of each tick"
```

---

## Task 18: cleanup.ts — winner cap + loser-blob sweep + finalize stats

**Files:**
- Create: `app/api/cron/cleanup-daily-snapshots/lib/cleanup.ts`
- Create: `app/api/cron/cleanup-daily-snapshots/lib/cleanup.test.ts`

Spec §3.2. Three responsibilities run once daily, all gated on yesterday's UTC date:

1. **Cap winners.** If yesterday's `is_window_winner=true` count > `DAILY_WINNER_GLOBAL_CAP`, demote the lowest-scoring excess to `is_window_winner=false`.
2. **Sweep old loser blobs.** Delete Firebase blobs for `is_window_winner=false` rows older than `LOSER_RETENTION_DAYS`. Set `firebase_url=NULL` on success; leave populated on Firebase-delete failure (retry tomorrow). DB row stays.
3. **Finalize daily_sunset_stats.** Write `winners_picked`, `winners_kept`, `winners_pruned`, `top_winner_score`, `finalized_at`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const deleteImageMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  deleteFromFirebase: (...a: unknown[]) => deleteImageMock(...a),
}));

import {
  capYesterdaysWinners,
  sweepOldLoserBlobs,
  finalizeDailyStats,
} from './cleanup';

beforeEach(() => {
  sqlMock.mockReset();
  deleteImageMock.mockReset().mockResolvedValue(undefined);
});

describe('capYesterdaysWinners', () => {
  it('demotes the lowest-scoring excess when count > cap', async () => {
    // Count query → 3 winners; cap is mocked at 2 in test code below.
    sqlMock
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ id: 10 }, { id: 11 }, { id: 12 }]) // ordered by score asc
      .mockResolvedValueOnce([]); // UPDATE

    const result = await capYesterdaysWinners(new Date('2026-06-15T12:00:00Z'), 2);
    expect(result.kept).toBe(2);
    expect(result.pruned).toBe(1);
    const updateCall = sqlMock.mock.calls.at(-1)!;
    const [, ...vals] = updateCall;
    expect(vals).toContain(10); // lowest-scoring demoted
  });

  it('is a no-op when count <= cap', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 5 }]);
    const result = await capYesterdaysWinners(new Date(), 100);
    expect(result.kept).toBe(5);
    expect(result.pruned).toBe(0);
  });
});

describe('sweepOldLoserBlobs', () => {
  it('deletes Firebase blobs older than the retention window and clears firebase_url', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { id: 50, firebase_path: 'snapshots/123/1.jpg' },
        { id: 51, firebase_path: 'snapshots/123/2.jpg' },
      ])
      .mockResolvedValueOnce([])  // clear url for 50
      .mockResolvedValueOnce([]); // clear url for 51

    const result = await sweepOldLoserBlobs(new Date('2026-06-15T12:00:00Z'), 7);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(0);
    expect(deleteImageMock).toHaveBeenCalledTimes(2);
  });

  it('leaves firebase_url populated when Firebase delete fails', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 60, firebase_path: 'snapshots/x.jpg' },
    ]);
    deleteImageMock.mockRejectedValueOnce(new Error('firebase down'));

    const result = await sweepOldLoserBlobs(new Date(), 7);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    // The clear-url UPDATE should NOT run when the delete failed.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeDailyStats', () => {
  it('writes winner counts + finalized_at for yesterday', async () => {
    sqlMock.mockResolvedValue([]);
    await finalizeDailyStats(new Date('2026-06-15T00:10:00Z'), {
      winnersPicked: 130,
      winnersKept: 100,
      winnersPruned: 30,
      topWinnerScore: 0.94,
    });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+daily_sunset_stats/i);
    expect(q).toMatch(/finalized_at\s*=\s*now\(\)/i);
    expect(values).toContain(100);
    expect(values).toContain(30);
    expect(values).toContain(0.94);
    // The UTC date for "yesterday" relative to 2026-06-15 00:10 is 2026-06-14.
    expect(values).toContain('2026-06-14');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { sql } from '@/app/lib/db';
import { deleteFromFirebase } from '@/app/lib/webcamSnapshot';

function yesterdayUtc(now: Date): string {
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}

export async function capYesterdaysWinners(
  now: Date,
  cap: number
): Promise<{ kept: number; pruned: number }> {
  const date = yesterdayUtc(now);

  const [row] = (await sql`
    select count(*)::int as count
    from webcam_snapshots
    where captured_at::date = ${date}
      and is_window_winner = true
  `) as { count: number }[];

  const total = row?.count ?? 0;
  if (total <= cap) {
    return { kept: total, pruned: 0 };
  }

  // Pull the lowest-scoring excess (the ones we'll demote). ORDER BY score
  // ASC so the bottom `total - cap` rows are what we want.
  const excess = total - cap;
  const rows = (await sql`
    select id
    from webcam_snapshots
    where captured_at::date = ${date}
      and is_window_winner = true
    order by ai_regression_score asc nulls first
    limit ${excess}
  `) as { id: number }[];

  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await sql`
      update webcam_snapshots
      set is_window_winner = false
      where id = any(${ids})
    `;
  }

  return { kept: cap, pruned: ids.length };
}

export async function sweepOldLoserBlobs(
  now: Date,
  retentionDays: number
): Promise<{ deleted: number; failed: number }> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = (await sql`
    select id, firebase_path
    from webcam_snapshots
    where captured_at::date <= ${cutoffDate}
      and is_window_winner = false
      and firebase_url is not null
      and firebase_path is not null
    limit 1000
  `) as { id: number; firebase_path: string }[];

  let deleted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await deleteFromFirebase(row.firebase_path);
      await sql`
        update webcam_snapshots
        set firebase_url = null
        where id = ${row.id}
      `;
      deleted += 1;
    } catch (err) {
      console.warn(
        `[cleanup] firebase delete failed for snapshot ${row.id}:`,
        err
      );
      failed += 1;
    }
  }

  return { deleted, failed };
}

export interface FinalizeInput {
  winnersPicked: number;
  winnersKept: number;
  winnersPruned: number;
  topWinnerScore: number | null;
}

export async function finalizeDailyStats(
  now: Date,
  input: FinalizeInput
): Promise<void> {
  const date = yesterdayUtc(now);
  await sql`
    update daily_sunset_stats
    set winners_picked = ${input.winnersPicked},
        winners_kept = ${input.winnersKept},
        winners_pruned = ${input.winnersPruned},
        top_winner_score = ${input.topWinnerScore},
        finalized_at = now(),
        updated_at = now()
    where date = ${date}
  `;
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/cleanup-daily-snapshots/lib/cleanup.ts app/api/cron/cleanup-daily-snapshots/lib/cleanup.test.ts
git commit -m "feat(cleanup): cap yesterday's winners, sweep loser blobs, finalize stats"
```

---

## Task 19: cleanup-daily-snapshots route

**Files:**
- Create: `app/api/cron/cleanup-daily-snapshots/route.ts`
- Create: `app/api/cron/cleanup-daily-snapshots/route.test.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const capMock = vi.fn();
const sweepMock = vi.fn();
const finalizeMock = vi.fn();
const sqlMock = vi.fn();

vi.mock('./lib/cleanup', () => ({
  capYesterdaysWinners: (...a: unknown[]) => capMock(...a),
  sweepOldLoserBlobs: (...a: unknown[]) => sweepMock(...a),
  finalizeDailyStats: (...a: unknown[]) => finalizeMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { GET } from './route';

beforeEach(() => {
  capMock.mockReset().mockResolvedValue({ kept: 100, pruned: 30 });
  sweepMock.mockReset().mockResolvedValue({ deleted: 12, failed: 0 });
  finalizeMock.mockReset().mockResolvedValue(undefined);
  sqlMock.mockReset().mockResolvedValue([{ winners_picked: 130, top_score: 0.94 }]);
  process.env.CRON_SECRET = 'shh';
});

function makeReq(secret = 'shh'): Request {
  return new Request('http://test/api/cron/cleanup-daily-snapshots', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('GET /api/cron/cleanup-daily-snapshots', () => {
  it('returns 401 when CRON_SECRET does not match', async () => {
    const res = await GET(makeReq('wrong'));
    expect(res.status).toBe(401);
  });

  it('caps, sweeps, finalizes, and returns counts', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      cap: { kept: 100, pruned: 30 },
      sweep: { deleted: 12, failed: 0 },
    });
    expect(capMock).toHaveBeenCalledTimes(1);
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it('still finalizes when sweep fails partially', async () => {
    sweepMock.mockResolvedValue({ deleted: 1, failed: 5 });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: FAIL — route not found.

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import {
  DAILY_WINNER_GLOBAL_CAP,
  LOSER_RETENTION_DAYS,
} from '@/app/lib/masterConfig';
import {
  capYesterdaysWinners,
  sweepOldLoserBlobs,
  finalizeDailyStats,
} from './lib/cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function verifyAuth(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${process.env.CRON_SECRET}`;
}

function yesterdayUtcDate(now: Date): string {
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!verifyAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const cap = await capYesterdaysWinners(now, DAILY_WINNER_GLOBAL_CAP);
  const sweep = await sweepOldLoserBlobs(now, LOSER_RETENTION_DAYS);

  // Read total winners picked + top score off yesterday's snapshot table.
  const yesterday = yesterdayUtcDate(now);
  const [stats] = (await sql`
    select count(*) filter (where is_window_winner = true)::int as winners_picked,
           max(ai_regression_score) filter (where is_window_winner = true) as top_score
    from webcam_snapshots
    where captured_at::date = ${yesterday}
  `) as { winners_picked: number; top_score: number | string | null }[];

  await finalizeDailyStats(now, {
    winnersPicked: stats?.winners_picked ?? 0,
    winnersKept: cap.kept,
    winnersPruned: cap.pruned,
    topWinnerScore: stats?.top_score == null ? null : Number(stats.top_score),
  });

  return NextResponse.json({
    ok: true,
    cap,
    sweep,
    yesterday,
  });
}
```

- [ ] **Step 4: Add the cron to vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/update-cameras",
      "schedule": "*/1 * * * *"
    },
    {
      "path": "/api/cron/cleanup-daily-snapshots",
      "schedule": "10 0 * * *"
    }
  ]
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `npm test -- --run app/api/cron/cleanup-daily-snapshots/`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/cleanup-daily-snapshots/route.ts app/api/cron/cleanup-daily-snapshots/route.test.ts vercel.json
git commit -m "feat(cron): daily cleanup — winner cap, loser blob sweep, stats finalize"
```

---

## Task 20: Phase 2 manual verification

**Files:** (no code changes)

- [ ] **Step 1: Apply Phase 2 migration on the deployment target DB**

```bash
psql "$DATABASE_URL" -f database/migrations/20260516_model_mosaic_phase2.sql
```

- [ ] **Step 2: Trigger the cleanup cron manually**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<preview-url>/api/cron/cleanup-daily-snapshots | jq .
```

Expected: HTTP 200, JSON includes `cap`, `sweep`, `yesterday`. On the first run after Phase 2 ships, `cap.pruned` is probably 0 (no day has exceeded the cap yet).

- [ ] **Step 3: Verify winners on yesterday's date**

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) FILTER (WHERE is_window_winner) AS winners,
       count(*) FILTER (WHERE NOT is_window_winner) AS losers,
       max(ai_regression_score) FILTER (WHERE is_window_winner) AS top
FROM webcam_snapshots
WHERE captured_at::date = current_date - 1;
"
```

Expected: `winners` ≤ `DAILY_WINNER_GLOBAL_CAP` (100); `top` is a sensible value.

- [ ] **Step 4: Confirm daily_sunset_stats is finalized**

```bash
psql "$DATABASE_URL" -c "
SELECT date, winners_picked, winners_kept, winners_pruned, top_winner_score, finalized_at
FROM daily_sunset_stats
WHERE finalized_at IS NOT NULL
ORDER BY date DESC LIMIT 5;
"
```

Expected: yesterday's row has `finalized_at` populated and the winner columns match the snapshot count from Step 3.

- [ ] **Step 5: Confirm Firebase blob count drops over the next week**

Note Firebase Storage usage today in the dashboard. After 7 days (`LOSER_RETENTION_DAYS`), storage should plateau or shrink as old loser blobs sweep out. If it keeps climbing, `sweep.failed` is probably high — check logs.

---

## Task 21: Remove the deprecated /api/cron/update-windy route

After **≥48 hours of zero traffic** to `/api/cron/update-windy` (check Vercel logs), do this. Not before.

**Files:**
- Delete: `app/api/cron/update-windy/route.ts`

- [ ] **Step 1: Confirm zero traffic**

In Vercel dashboard, filter logs for `/api/cron/update-windy` over the last 48h. Expected: zero hits.

- [ ] **Step 2: Delete the file**

```bash
git rm app/api/cron/update-windy/route.ts
rmdir app/api/cron/update-windy 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove deprecated /api/cron/update-windy re-export"
```

---

## Open follow-ups (not bundled in this plan)

These were flagged in the spec or surfaced during planning, and should ride future PRs:

- **Bound score-write writes per webcam per day.** Even with the Redis hash cache, Windy previews change up to ~10×/day per camera. If `webcams.ai_rating_regression` UPDATEs become a Neon cost concern, gate by "score changed by ≥0.05 since last write." Not now — let Phase 1 data tell us.
- **Move `customScores` aggregation from placeholder to real per-snapshot scores.** The placeholder in Task 12 conflates count with score distribution. Easy to fix once `backfillCustomSnapshotScores` returns the raw scores list.
- **Phase 3 live video.** Sketched in spec §Phase 3. Wait until at least one Pi camera is streaming HLS.
- **Loser-blob audit column.** Spec §"Future cleanup" mentions a `firebase_url_deleted_at` for cleaner audits. Skip until needed.
- **Collapse the dual scoring scale.** `rawScore` 0..1 vs `aiRating` 0..5 — eventual cleanup. Coordinated migration; not bundled here.
