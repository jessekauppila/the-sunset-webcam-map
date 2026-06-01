# Where we are — 2026-05-31

**For the next Claude session:** Read this file first. It captures the state of work in flight, what just shipped, and the next concrete step.

---

## What's next (start here)

**Wire the v2 binary classifier into the cron** so the popup verdict comes from a real "is this a sunset?" signal instead of regression-threshold proxy.

- Memory with full plan: `memory/project_two_tier_sunset_classification.md`
- The popup already supports this — when binary score lands, the visual stays identical, only `aiRatingBlock.ts`'s threshold gate flips from regression to binary
- Open design decision to brainstorm BEFORE implementing: ship with v2 binary as placeholder, or train a v4 binary on the same Flickr-augmented dataset that v4 regression used? v2 is March-vintage but the "is this a sunset" task is coarser than quality ranking — may be Good Enough

**Recommended first move:** invoke the brainstorming skill on the v2-vs-train-v4 question, then write a spec → plan → implement using subagent-driven-development.

---

## What shipped tonight (all merged to main)

| PR | Branch | What |
|---|---|---|
| #18 | `feat/scoring-observability` | `scoringPaths` counter on cron response + `/api/debug/scoring-smoke` endpoint + 55KB JPEG fixture |
| #19 | `feat/persist-scoring-path` | `webcam_snapshots.scoring_path` column + write-path + migration |
| #20 | `fix/smoke-endpoint-includefiles` | 3-line `vercel.json` patch so smoke endpoint ships the ONNX model |
| #21 | `feat/cloud-wizard-skeleton` | `/setup/[claim_code]` skeleton — 4 of 6 screens working + submit (AR + horizon-sweep are placeholders pending brainstorm) |
| #24 | `feat/popup-rating-redesign` | New AI-rating block in `webcamPopup.tsx` — "Sunset detected" vs "Not a sunset right now" with SVG stars, drops the misleading duplicate "Binary: N" line |

Earlier in the day before tonight:
- #16: `fix/build-type-error-customclassification` — Number() coercion fix that unblocked all builds
- PR before this thread: `fix/custom-cam-rating-mapping` (PR #15) — fixed the 0.21/5 display bug

---

## What's queued (in priority order)

**1. Two-tier sunset classification** (the thing we're about to start)
- `memory/project_two_tier_sunset_classification.md` — full inventory + 4 open questions + sketch
- Forward-compatible with the popup redesign already merged

**2. Manual rating for custom cams**
- `memory/project_manual_rating_for_custom_cams.md`
- Augment v4 ONNX with a `manual_rating` column + simple labeling UI
- Addresses the silhouette-sunset blind spot; labels feed v5 training
- Needs brainstorming pass first

**3. AR overlay + horizon sweep for cloud wizard (screens 4-5)**
- Cloud wizard skeleton from PR #21 has these as "Skip for now" placeholders
- Real design: compass calibration UX, three.js vs canvas2D, three solstice/equinox arcs over live camera feed
- Per `memory/project_streamlined_deployment_status.md`, this is the visible-progress piece of Subproject F

**4. Tasks 4-11 of streamlined-model-deploy plan**
- `docs/superpowers/plans/2026-05-16-streamlined-model-deploy.md`
- The bash deploy script + Python validator
- Deferred until next model deploy

---

## Verification you can run after merge to confirm health

```bash
# Pull CRON_SECRET from Vercel into shell
npx vercel env pull --environment=production .env.production.tmp
export CRON_SECRET=$(grep ^CRON_SECRET .env.production.tmp | cut -d= -f2- | tr -d '"')
rm .env.production.tmp

# 1. Smoke endpoint says ONNX is running
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.sunrisesunset.studio/api/debug/scoring-smoke | jq

# Expect: { "pathTaken": "onnx", "modelVersion": "v4_regression_llm_with_flickr", ... }

# 2. Cron response shows scoringPaths breakdown
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://www.sunrisesunset.studio/api/cron/update-cameras | jq '.scoringPaths'

# Expect: { "onnx": N, "cache-hit": M, "baseline-fallback": 0, "baseline": 0 }
```

---

## Worktrees to clean up

All five from tonight can be removed (their PRs merged):

```bash
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-buildfix
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-scoring-obs
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-smoke-bundle
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-pathtaken-db
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-cloud-wizard
git worktree remove /Users/jessekauppila/GitHub/the-sunset-webcam-map-popup-rating
```

The main checkout (`~/GitHub/the-sunset-webcam-map/`) is still on `feat/pi-alignment-tool-v2-mpu6050` from a parallel session — switch to main when ready:

```bash
git checkout main && git pull --ff-only
```

---

## Open backlog SQL tasks

These haven't been run yet on Neon:

**Backfill stale custom-cam display ratings** (from the May 17 fix):
```sql
UPDATE webcams
SET ai_rating_regression = 1 + ls.ai_regression_score * 4
FROM (
  SELECT DISTINCT ON (s.webcam_id)
         s.webcam_id, s.ai_regression_score
  FROM webcam_snapshots s
  JOIN webcams w ON w.id = s.webcam_id
  WHERE w.source = 'custom'
    AND s.ai_regression_score IS NOT NULL
  ORDER BY s.webcam_id, s.captured_at DESC
) ls
WHERE id = ls.webcam_id;
```

**Apply scoring_path migration** (from PR #19):
```bash
psql "$DATABASE_URL" -f database/migrations/20260518_webcam_snapshot_scoring_path.sql
```

---

## Key memories (read these for context)

- `memory/project_two_tier_sunset_classification.md` ← **most relevant for next session**
- `memory/feedback_silent_ml_fallback.md` — the silent-fallback pattern that we ship guardrails against
- `memory/project_manual_rating_for_custom_cams.md` — queued, related but separate from two-tier
- `memory/project_streamlined_deployment_status.md` — broader Subproject F context

---

## The big picture as of tonight

The "AI scoring" stack has gone from "we shipped v4 but it was silently falling back to a metadata heuristic" (where we were May 15) to:

1. Real v4 ONNX inference confirmed running in production
2. Per-tick + per-snapshot observability that catches silent-fallback regressions instantly
3. The popup correctly distinguishes "sunset" from "not a sunset" using a regression-threshold proxy
4. Infrastructure is in place to swap that proxy for a real binary classifier — that's the next chunk

The remaining gap between "good" and "great" on the AI side is teaching the model about silhouette sunsets and other cases where v4 disagrees with the user's eye. That's the manual-rating project, downstream of the two-tier work.
