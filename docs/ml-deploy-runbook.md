# ML Model Deploy Runbook

> **Audience:** Future Jesse, or any subagent doing a model deploy without the full session context.
> **Last verified:** 2026-06-01, after deploying v4 binary classifier alongside v4 regression.
> **Format:** 6 sequential steps + 5 traps with their workarounds. Read the traps section before starting if it's been a while.

This is the **minimum-viable runbook**. The fully-automated `scripts/deploy-model.sh` orchestrator is specified at `docs/superpowers/plans/2026-05-16-streamlined-model-deploy.md` but not yet built. Until it is, follow this doc by hand.

---

## Prerequisites

- Active venv: `source ~/GitHub/the-sunset-webcam-map/.venv/bin/activate`
- Vercel CLI logged in: `npx vercel whoami`
- `$CRON_SECRET` exported in shell:
  ```bash
  npx vercel env pull --environment=production .env.production.tmp
  export CRON_SECRET=$(grep ^CRON_SECRET .env.production.tmp | cut -d= -f2- | tr -d '"')
  rm .env.production.tmp
  ```

---

## The 6 steps

### 1. Train

```bash
python ml/run_training.py --config ml/configs/<your_config>.yaml
```

**Critical sanity check** — before training kicks off, the dataset-export summary block prints. Look for:

```json
"target_distribution": {
  "full": { "positive_rate": ~0.10 to 0.20 }
}
```

If `positive_rate` is **0** or 1.0, kill training. See Trap #1 below.

Training writes to `ml/artifacts/experiments/<timestamp>_<run_name>/`. Note that path — every step below references it.

### 2. Verify the eval report is sane

After early-stop, the runner emits an eval report. Open it:

```bash
cat ml/artifacts/experiments/<timestamp>_<run_name>/eval/eval_report.json | jq '{ f1, balanced_accuracy, auc, confusion, best_threshold_by_f1 }'
```

What good looks like (binary classifier):
- `f1 >= 0.80`
- `balanced_accuracy >= 0.90` (accounts for class imbalance)
- `auc >= 0.95`
- `confusion.tp > 0` and `confusion.tn > 0` — both classes have right-answers

If the model never predicts positives (`confusion.tp == 0`), something's wrong upstream. Don't deploy.

### 3. Export ONNX

```bash
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<timestamp>_<run_name> \
  --target-type binary \    # or regression
  --model-name resnet18
```

Produces:
- `ml/artifacts/models/<target_type>_resnet18/<timestamp>_<run_name>/model.onnx` (~43 MB)
- `ml/artifacts/models/<target_type>_resnet18/<timestamp>_<run_name>/model.meta.json`

Note the full version tag (`<timestamp>_<run_name>`). You'll paste it into Vercel.

### 4. Commit and push

```bash
git add ml/artifacts/models/<target_type>_resnet18/<timestamp>_<run_name>/
git commit -m "deploy: add <target_type> ONNX (<version_tag>) — F1=N.NN, AUC=N.NNN"
git push
```

Open the PR, merge. Vercel auto-deploys on merge to main. **Don't skip this even if the env vars are still wrong — the file has to be on `main` before any deploy can bundle it.**

### 5. Set Vercel env vars + redeploy

For a **regression** model:
```
AI_ONNX_REGRESSION_MODEL_PATH = ml/artifacts/models/regression_resnet18/<version_tag>/model.onnx
AI_REGRESSION_MODEL_VERSION   = <version_tag>
AI_SCORING_MODE               = onnx        # only if not already set
```

For a **binary** model:
```
AI_BINARY_SCORING_ENABLED   = true
AI_ONNX_BINARY_MODEL_PATH   = ml/artifacts/models/binary_resnet18/<version_tag>/model.onnx
AI_BINARY_MODEL_VERSION     = <version_tag>
AI_BINARY_SUNSET_THRESHOLD  = 0.5           # tunable; only required if you want non-default
```

**Scope:** match whatever the existing AI_* vars use (today it's "All Environments"; can also be "Production and Preview"). NOT "Production only" — preview deploys need them for sanity-checking.

After saving, click "Redeploy" on the latest production deploy so the new env vars take effect.

### 6. Verify (the only step that proves it worked)

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.sunrisesunset.studio/api/debug/scoring-smoke | jq
```

**Pass criteria:**

| Field | Expected | Why |
|---|---|---|
| `pathTaken` | `"onnx"` | NOT `"baseline-fallback"` |
| `latencyMs` | 100-500 | < 30 = baseline, > 500 = degraded |
| `modelVersion` | matches your new tag | confirms env var routing |
| `binaryPathTaken` | `"onnx"` (if binary deployed) | NOT `"baseline-fallback"` |
| `binaryRawScore` | nonzero | not the default 0 |

If `pathTaken` is `"baseline-fallback"`, the model file isn't being found in the function bundle. See Trap #3.

If `latencyMs < 30`, the response is the metadata baseline. Sanity check: `rawScore: 0.21` means `baselineRaw({viewCount: 0, manualRating: 3})` exactly — a deterministic signature of "ONNX didn't run."

---

## Traps that cost us hours

### Trap 1: `binary_threshold: 4.0` produces zero positives

**Symptom:** Dataset export prints `"positive": 0` despite v4 regression having succeeded on the same data.

**Why:** Labels are normalized to [0, 1] in `merge_label` before `to_binary` sees them. The historical default `4.0` came from when labels were raw 1-5; nothing in [0,1] ever crosses 4.0.

**Fix:** In your binary config yaml, `binary_threshold: 0.75` (= rating ≥ 4 in normalized space). The defaults in `ml/common/labels.py`, `ml/export_dataset.py`, and `ml/run_experiment.py` are all `0.75` since 2026-05-31.

**Mapping:**
| Raw rating cutoff | Normalized |
|---|---|
| ≥ 3 | 0.50 |
| ≥ 4 | **0.75 (default)** |
| ≥ 4.5 | 0.875 |

See `memory/feedback_normalized_vs_raw_thresholds.md`.

### Trap 2: Squash-merging breaks `git branch -d` for branches that "should be" merged

**Symptom:** `git branch -d feat/something` says "not fully merged" even though the PR landed on main.

**Why:** Squash-merge replaces the branch's commits with a single new commit on main. The branch's original tip isn't an ancestor of main anymore.

**Fix:** Use `git branch -D` (capital D) for branches you're confident shipped. Or check the PR's "Merged" badge on GitHub before forcing.

### Trap 3: `vercel.json` `functions.includeFiles` silently doesn't ship files

**Symptom:** Smoke endpoint returns `pathTaken: "baseline-fallback"`, `latencyMs: 15`, `rawScore: 0.21`. Vercel logs say `Load model from /var/task/ml/artifacts/models/... failed. File doesn't exist`.

**Why:** The `vercel.json` `functions.includeFiles` glob is silently ignored for app-router routes on Next.js 15. Doesn't matter what glob syntax you use — brace expansion, `**`, exact paths — nothing matches.

**Fix:** Use `next.config.ts` `outputFileTracingIncludes` instead. The key MUST be the route path (`'/api/cron/update-cameras'`), NOT the file path (`'app/api/.../route'`). The file-path form silently no-ops.

```ts
outputFileTracingIncludes: {
  '/api/cron/update-cameras': ['./ml/artifacts/models/regression_resnet18/**/*'],
  '/api/debug/scoring-smoke': ['./ml/artifacts/models/binary_resnet18/**/*'],
},
```

**Verify locally before pushing:**
```bash
npm run build  # may need DATABASE_URL=postgresql://stub:stub@localhost/stub stubbed
jq -r '.files[] | select(test("model.onnx"))' \
  .next/server/app/api/cron/update-cameras/route.js.nft.json
```

If that prints model.onnx paths, your include is working. If empty, the route-key format is wrong.

See `memory/feedback_vercel_nextjs_ml_bundling.md`.

### Trap 4: Bundle size approaches 250 MB

**Symptom:** Vercel build fails with `Function bundle exceeded 250 MB`.

**Current accounting (as of 2026-06-01):**
- onnxruntime-node linux/x64 CPU: ~36 MB
- sharp libvips: ~16 MB
- 4 × ResNet-18 ONNX (2 regression + 2 binary, including v2 versions): ~172 MB
- Next.js framework + traced deps: ~40 MB
- **Total: ~264 MB** — Vercel's actual accounting is more permissive than this estimate so we're shipping today, but it's close

**Fix when it actually fails:**
1. `git rm` the unused v2 ONNX files:
   ```bash
   git rm ml/artifacts/models/regression_resnet18/20260315_003913_v2_regression_mild_crop/
   git rm ml/artifacts/models/binary_resnet18/20260314_070706_v2_mild_crop_balanced/
   ```
   Saves ~86 MB. The `.pt` checkpoints remain for rollback via re-export.
2. If still over, revisit the `outputFileTracingExcludes` in `next.config.ts` for onnxruntime-node — the existing excludes drop ~350 MB of unused platform binaries; if a newer version adds more, extend the list.

### Trap 5: `CRON_SECRET` is wrong / unset between shells

**Symptom:** Smoke endpoint returns HTTP 401 plain text → `jq: parse error`.

**Fix:**
```bash
echo "len: ${#CRON_SECRET}"   # should be 23
# if not 23, re-pull from Vercel
npx vercel env pull --environment=production .env.production.tmp
export CRON_SECRET=$(grep ^CRON_SECRET .env.production.tmp | cut -d= -f2- | tr -d '"')
rm .env.production.tmp
```

If `len: 23` and STILL 401, the secret got rotated on Vercel — the env pull above already grabbed the new value, just retry.

---

## Cheat-sheet pasta

The whole thing as one block, fill in `<placeholders>`:

```bash
# 1. Train
python ml/run_training.py --config ml/configs/<config>.yaml

# 2. Verify eval
jq '{f1, balanced_accuracy, auc, confusion}' \
  ml/artifacts/experiments/<run>/eval/eval_report.json

# 3. Export
python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<run> \
  --target-type <binary|regression> \
  --model-name resnet18

# 4. Ship
git add ml/artifacts/models/<type>_resnet18/<version_tag>/
git commit -m "deploy: add <type> ONNX (<version_tag>)"
git push  # then merge the PR on GitHub

# 5. Vercel env vars (UI), then click Redeploy

# 6. Verify
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.sunrisesunset.studio/api/debug/scoring-smoke | jq
```

---

## Related docs and memories

- Memory: `feedback_silent_ml_fallback.md` — the umbrella pattern
- Memory: `feedback_normalized_vs_raw_thresholds.md` — Trap 1
- Memory: `feedback_vercel_nextjs_ml_bundling.md` — Traps 3 and 4
- Plan: `docs/superpowers/plans/2026-05-16-streamlined-model-deploy.md` — what this runbook will eventually become a script of
- Operating guide: `ml/OPERATING_GUIDE.md` §9 — the broader env-var reference
