# Streamlined Model Deploy — Design

**Status:** Draft, 2026-05-16
**Scope:** A single command that takes a trained PyTorch model run and ships it to Vercel as a working ONNX inference path, with guardrails against the silent-fallback pattern that hid a broken deploy for a week (see `memory/feedback_silent_ml_fallback.md`).
**Out of scope:** Training itself, schema changes to `webcam_snapshots`, AWS/Cloud-Run support.

---

## Motivation

Tonight's deploy of the v4 regression model exposed five stacked bugs in the train → ONNX → Vercel hand-off:

1. v4 was never exported because `export_onnx.py` crashed silently on the `head_dropout=0.3` head shape
2. ONNX output range [0,1] was being read as 1-5 stars by the cron
3. `await import(varName)` indirection hid `onnxruntime-node` from Vercel's output-file tracer → MODULE_NOT_FOUND in production
4. After fixing #3, the function bundle ballooned to 425 MB because all platform binaries (darwin/win32/linux × CPU/GPU) shipped → exceeded Vercel's 250 MB hard limit
5. The cron's `try { onnx } catch { baseline }` fallback succeeded plausibly for every webcam, masquerading as real inference for a week; only the `fallbacks` field in the cron response would have caught it

Each individual bug was diagnosable in 15 minutes once seen. The expensive part was discovering *that they existed*. The deploy script and verification artifacts in this design make every one of them either impossible or immediately visible the next time we ship a model.

The user expects to ship models a few times per year, not weekly. The design optimizes for "works correctly when used after a long gap" — explicit prompts, no hidden state, generous validation.

## Goal

```bash
scripts/deploy-model.sh ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr/
```

…walks through 5 stages and either fails loud with an actionable error or ends with `✓ ONNX confirmed running in production`. Rerunnable from any stage. Portable to future Vercel-hosted ML projects via a 6-line CONFIG block.

---

## Architecture: five stages

```
scripts/deploy-model.sh <run_dir> [--start-at N] [--force] [--unattended]
  ├─ 1. Export    → ml/export_onnx_versioned.py
  ├─ 2. Validate  → ml/validate_deploy_bundle.py  (NEW)
  ├─ 3. Stage     → git add + commit + push
  ├─ 4. Vercel    → vercel env add (if needed) + wait for deploy
  └─ 5. Verify    → /api/debug/scoring-smoke + /api/cron/update-cameras
```

### Stage 1 — Export

Wraps the existing `ml/export_onnx_versioned.py`. The `<version_tag>` is `Path(run_dir).name` — the full run_dir basename including the timestamp prefix (e.g. `20260513_113243_v4_regression_llm_with_flickr`), matching `export_onnx_versioned.py:66`. Skips if `model.onnx` for that tag already exists at `ml/artifacts/models/<MODEL_FAMILY>/<version_tag>/model.onnx`. Print `✓ Already exported`.

### Stage 2 — Validate (new: `ml/validate_deploy_bundle.py`)

Four checks, each pass/fail printed independently:

1. **PyTorch ↔ ONNX parity** — load both, run a single fixed-seed random input through each, assert `max(abs(pt - onnx)) < 1e-5`. Catches head-shape mismatches and silent export corruption.
2. **ONNX file size** — assert `model.onnx ≤ 100 MB`. GitHub's per-file LFS-free limit.
3. **Estimated Vercel bundle size** — sum the files Vercel's tracer would ship for `app/api/cron/update-cameras/route.ts` after the `outputFileTracingExcludes` we have in `next.config.ts`. Specifically:
   - `node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1`
   - `node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node`
   - `node_modules/@img/sharp-libvips-linux-x64/**`
   - `node_modules/sharp/**`
   - `ml/artifacts/models/<MODEL_FAMILY>/<version_tag>/**`
   - All `.next/server/**` traced files (run `next build --debug` once to capture)
   Assert sum ≤ `MAX_BUNDLE_MB` (default 200 MB, 50 MB margin under Vercel's 250 MB).
4. **Eval report** — load `<run_dir>/eval/eval_report.json`. Print pearson, R², MAE. Refuse to proceed if pearson < 0.5. Override with `--force`.

### Stage 3 — Stage in git

```bash
git add ml/artifacts/models/<MODEL_FAMILY>/<version_tag>/
git diff --cached --stat                          # show what's about to commit
echo "Proposed commit message: deploy: <version_tag>"
read -p "Commit and push? [y/N] " yn
```

On yes: commit + push. On no (or `--unattended` with no changes): skip with note.

### Stage 4 — Vercel env vars + deploy

For each required env var (`AI_ONNX_REGRESSION_MODEL_PATH`, `AI_REGRESSION_MODEL_VERSION`, `AI_SCORING_MODE=onnx`):

1. `vercel env ls production` → check if already set to the right value
2. If set correctly: skip, print `✓ <VAR> already set`
3. If wrong or missing: print current value, print new value, prompt to overwrite. On yes:
   ```bash
   vercel env add <NAME> production --value "<new-value>" --force --yes
   ```
   `--force` overwrites without a separate `rm` step. `--value` skips the interactive stdin prompt. `--yes` skips the confirmation. Verified against Vercel CLI 39+ on 2026-05-16.

After env vars:
- If Stage 3 made a commit, the git push already triggered an auto-deploy. Poll `vercel ls --prod` until latest deployment shows `READY`.
- If Stage 3 was a skip (code unchanged, only env vars changed), run `vercel --prod` to force a new deploy that picks up the new env.

### Stage 5 — Verify

Two checks, in order:

1. **Smoke test (deterministic)** — `curl -H "Authorization: Bearer $CRON_SECRET" $PROD_URL/api/debug/scoring-smoke` → expect `pathTaken: "onnx"`, `modelVersion` matches `<version_tag>`, latency < 5000 ms. This is independent of cron timing.
2. **Cron sample (statistical)** — hit `/api/cron/update-cameras` 3 times with 30s gaps. For each tick where `windyScored > 0`, assert `fallbacks === 0`. If `fallbacks > 0` at any point, print the last 20 lines of `vercel logs --since=5m` and exit non-zero.

On pass: `✓ ONNX confirmed running in production (version: <version_tag>)`.

---

## State, idempotency, and failure handling

**No local state file.** The world is the source of truth (git + filesystem + Vercel + cron response). Each stage queries the world to decide whether to skip. Eliminates the "state file says I'm done but reality says I'm not" failure mode.

**`<version_tag>` is the only cross-stage key**, derived deterministically as `Path(run_dir).name`. Two invocations with the same `<run_dir>` always produce the same tag.

| Stage | If it fails | Recovery |
|---|---|---|
| 1 Export | Stops. Usually `head_dropout` mismatch or missing `best.pt` | Fix run_dir contents, rerun |
| 2 Validate | Stops with which check(s) failed. `--force` skips the entire stage | Investigate, or `--force` and own the risk |
| 3 Stage | Prompt declined → exit clean. Push fails → standard git error, repo unchanged | Resolve, rerun with `--start-at 3` |
| 4 Vercel | Auth → tells you to `vercel login`. Deploy fails → prints failure URL | Fix, rerun with `--start-at 4` |
| 5 Verify | `fallbacks > 0` or smoke test wrong pathTaken → prints `vercel logs` and exits 1 | Fix root cause, rerun just stage 5 |

**Destructive operations** (always prompt, never silent in default mode):

- Stage 4 may overwrite existing Vercel env vars. Prints current value vs new value side-by-side before doing so.
- `--unattended` skips all prompts (accepts every default). Intended only for re-runs of a previously-completed deploy.

---

## Verification & silent-fallback prevention

Three changes; (a) and (b) are required for this design, (c) is flagged as future work.

### (a) Richer cron response

Add `scoringPaths` breakdown to `/api/cron/update-cameras` response:

```json
{
  "scoringPaths": { "onnx": 4, "baseline-fallback": 0, "cache-hit": 78, "baseline": 0 }
}
```

Counts come directly from `scored.pathTaken`. Makes "is ONNX really running" inspectable from a single curl. `scoringPaths.onnx > 0 && scoringPaths['baseline-fallback'] === 0` is the green-light condition.

**Cost:** ~15 lines in `app/api/cron/update-cameras/route.ts`. No schema change.

### (b) Smoke-test endpoint (`/api/debug/scoring-smoke`)

```
GET /api/debug/scoring-smoke
Authorization: Bearer $CRON_SECRET
```

Implementation:

1. Reads a committed ~50 KB JPEG from `app/api/debug/scoring-smoke/test-image.jpg`
2. Calls `scoreImage()` with `lastImageHash: undefined` (forces real scoring, bypasses any cache)
3. Returns `{pathTaken, rawScore, aiRating, modelVersion, latencyMs}`

Provides the canonical "is ONNX actually running on this deployment, right now, deterministically" check. Independent of cron timing or which webcams happened to rotate their images. Stage 5 calls this *first*, then samples the real cron.

**Cost:** ~40 lines + a committed test JPEG.

### (c) DEFERRED — persist `pathTaken` to DB

A `scoring_path TEXT` column on `webcam_snapshots`, written from `scored.pathTaken` (not from env var). Lets you SQL-filter for contaminated rows after a future broken deploy. Out of scope for this design because:

1. DB migration + write-path change, not deploy-streamlining
2. (a) + (b) already answer "did the deploy work"
3. Phase 2 winner-selection will touch the same write path — better to bundle the schema change there

Worth tracking separately. Recorded in `memory/feedback_silent_ml_fallback.md` point 1.

---

## Portability — the CONFIG block

Top of `scripts/deploy-model.sh`:

```bash
# === Project config (edit when porting to a new repo) ===
MODEL_FAMILY="regression_resnet18"           # ml/artifacts/models/<this>/<version>/
ENV_VAR_MODEL_PATH="AI_ONNX_REGRESSION_MODEL_PATH"
ENV_VAR_MODEL_VERSION="AI_REGRESSION_MODEL_VERSION"
ENV_VAR_SCORING_MODE="AI_SCORING_MODE"
CRON_ENDPOINT="/api/cron/update-cameras"
SMOKE_ENDPOINT="/api/debug/scoring-smoke"
MAX_BUNDLE_MB=200
PROD_URL="https://www.sunrisesunset.studio"
```

Porting to a new Vercel + onnxruntime-node project: copy `scripts/deploy-model.sh`, `ml/validate_deploy_bundle.py`, and `app/api/debug/scoring-smoke/`, edit the CONFIG block, done. The body is generic.

Three tiers of portability for this work overall:

| What | Portable to |
|---|---|
| Pattern (PyTorch → ONNX → onnxruntime-node on Vercel) | Universal |
| `scripts/deploy-model.sh` + `validate_deploy_bundle.py` + `scoring-smoke` | Any Vercel + onnxruntime-node project, edit CONFIG block |
| `ml/` training scaffolding (`run_training.py`, `export_dataset.py`, etc.) | Specific to image classification/regression with this column layout |

---

## Files affected

**New:**

- `scripts/deploy-model.sh` (~150 lines bash)
- `ml/validate_deploy_bundle.py` (~120 lines Python)
- `app/api/debug/scoring-smoke/route.ts` (~50 lines)
- `app/api/debug/scoring-smoke/test-image.jpg` (~50 KB sample sunset photo)

**Modified:**

- `app/api/cron/update-cameras/route.ts` — add `scoringPaths` counter and include in response (~15 lines)
- `ml/OPERATING_GUIDE.md` §9 — point to the new script as the canonical workflow; keep the manual steps as fallback documentation
- `package.json` — add `"deploy-model": "./scripts/deploy-model.sh"` script entry for `npm run deploy-model -- <run_dir>`

---

## Testing

- `ml/validate_deploy_bundle.py` — unit test the parity check with a known-good ONNX + .pt fixture; size estimator can be tested against the current v4 deploy whose true bundle size we know
- `/api/debug/scoring-smoke/route.ts` — vitest test mocking `scoreImage` to return each `pathTaken` value, assert the response shape
- `scripts/deploy-model.sh` — no automated tests; manually re-runnable on the existing v4 deploy as a dry run (Stage 1 skips because exported, Stage 3 skips because committed, Stage 4 skips because env vars set, Stage 5 should pass)

---

## Success criteria

1. `scripts/deploy-model.sh ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr/` completes cleanly against the current production state (all stages skip except Stage 5)
2. Running the same against a fresh, never-deployed run takes a model from `best.pt` to confirmed-running-in-production in under 10 minutes wall time, with every destructive action confirmed by prompt
3. A future broken ONNX deploy — whether caused by bundle size, MODULE_NOT_FOUND, head-shape mismatch, or any of the other tonight-class failures — exits Stage 2 or Stage 5 non-zero with an actionable error message; never returns success with a silent fallback running
