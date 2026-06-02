# Hard-Example Mining Handoff — 2026-06-02

> **For the next Claude session:** Read this first. Captures the state of work at end-of-session on 2026-06-02.

---

## TL;DR

Built the hard-example mining + private labeling system end-to-end across 16 commits on `feat/hard-example-mining`. Branch is pushed; PR is **ready to merge** but not yet opened on GitHub. Schema migration is forward-compatible and can be applied before or after merge. Once shipped, the cron starts auto-flagging binary↔regression disagreements (both Windy and custom Pi paths), and you can label them via the new "⚠ Hard Examples" drawer tab.

**One immediate action on resume:** open and merge https://github.com/jessekauppila/the-sunset-webcam-map/pull/new/feat/hard-example-mining

---

## Current branch + PR state

| Item | Status |
|---|---|
| Branch | `feat/hard-example-mining` — 16 commits ahead of main, pushed to origin |
| Build | ✅ clean |
| Tests | 281 pass, 2 chronic pre-existing failures (`useSetMarker.test.ts`, `terminatorRing.test.ts`) — same failures exist on `main` |
| PR | Not yet opened. URL ready: `https://github.com/jessekauppila/the-sunset-webcam-map/pull/new/feat/hard-example-mining` |
| Migration | NOT yet applied to Neon. File at `database/migrations/20260602_hard_example_mining.sql`. Idempotent + forward-compatible (all new columns nullable). |

### Suggested PR description (paste into GitHub when opening)

```markdown
## Summary

Implements `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`. Three database columns, a cron-side auto-flag, a CLEANUP_ENABLED gate that respects training-data retention, a new private drawer tab for labeling model-disagreement snapshots, Yes/No verdict buttons that gate the star rating, and removal of the public popup rating widget. Both Windy and custom Pi camera scoring paths write the disagreement flag.

## Database migration

Applied via:
```bash
psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql
```
Idempotent. Run before deploying the code changes (all new columns nullable; old code keeps working).

## Test plan

- [x] vitest: full suite passes (besides chronic terminatorRing + useSetMarker failures unrelated to this PR)
- [x] Production build clean
- [ ] After deploy: open the drawer, confirm "⚠ Hard Examples" tab renders left of "Snapshot Archive"
- [ ] After deploy: click a webcam on the map → popup shows verdict + stars but NO Rate UI
- [ ] After deploy: in Hard Examples tab, click No on a snapshot → it leaves the queue; click Yes + 4 stars on another → it leaves the queue; query DB to confirm `webcam_snapshot_ratings.is_sunset_verdict` and `webcam_snapshots.human_sunset_majority` populated
- [ ] After deploy: verify `CLEANUP_ENABLED` is false by `curl -X POST .../api/snapshots/cleanup` and confirming `{deleted: 0, skipped_reason: 'CLEANUP_ENABLED is false...'}`

## What's not in this PR

- Phase 2 winner-selection retention exclusion (lands when winner-selection ships)
- Hard-example dataset extraction in `ml/export_dataset.py` (lands when v5 training starts)
- Operator auth (anonymous session model continues)

## References

- Spec: `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`
- Plan: `docs/superpowers/plans/2026-06-02-hard-example-mining-and-private-labeling.md` (still on `docs/hard-example-mining-plan` branch, never opened as own PR)
```

---

## What this PR ships

| Layer | What changed |
|---|---|
| **Schema** | `webcam_snapshot_ratings.is_sunset_verdict BOOLEAN` (per-user verdict); `webcam_snapshots.human_sunset_majority BOOLEAN` (denormalized majority vote); `webcam_snapshots.model_disagreement_kind TEXT` (cron-written triage flag); partial index on `(captured_at DESC) WHERE model_disagreement_kind IS NOT NULL` for fast queue reads |
| **Cron auto-flag** | `computeDisagreementKind()` helper in `aiScoring.ts`. Fires in BOTH paths: custom Pi backfill (via `customBackfill.ts` → `updateSnapshotAiRegressionScore`) AND Windy main loop (via `scoreOneWindy` → new `insertWindyDisagreementSnapshot` helper that uploads to Firebase + inserts a snapshot row). Windy path is critical — Windy is 99% of the corpus. |
| **Cleanup endpoint** | New `CLEANUP_ENABLED` constant in `masterConfig.ts` (default FALSE). Endpoint refuses to delete anything when gate is off. When on, retention rules exclude human-touched (any `rating IS NOT NULL OR is_sunset_verdict IS NOT NULL` row) and disagreement-flagged rows. DANGER comment block at top of `route.ts` explains the policy |
| **Rate endpoint** | Accepts `isSunsetVerdict?: boolean` alongside optional `rating`. Validates "can't rate non-sunsets" (rating + verdict=false → 400). Recomputes `human_sunset_majority` via SQL CASE on every submit + delete |
| **Snapshots API** | New `mode=hard-examples` returns disagreement-flagged rows, ordered newest-first, excluding snapshots the current `user_session_id` has already verdicted |
| **Zustand store** | Mode union extended to `'archive' \| 'curated' \| 'unrated' \| 'hard-examples'`; new `hardExamples*` state fields + actions mirror the archive pattern |
| **SnapshotConsole** | Supports `mode="hard-examples"` |
| **VerdictButtons** | New `app/components/console/VerdictButtons.tsx` — Yes/No pair with phase-aware copy. `useVerdictState` hook exposes `starsEnabled` (true only when verdict === true) |
| **SnapshotQueueCard** | Renders VerdictButtons above the stars. "No" submits immediately with `isSunsetVerdict: false`. "Yes" enables stars; star click submits with both fields. Hotkey path (1-5 digits) sends `isSunsetVerdict: true` for back-compat with the existing flow |
| **RatingCard.readOnly** | New optional prop. When `true`, hides the rate prompt + StarRating widget. Map popup mounts with `readOnly={true}` so the public site cannot write to the rate endpoint. Drawer-side surfaces leave it unset (default false) → full UX |
| **HomeClient** | New `<Tab label="⚠ Hard Examples" />` inserted at index 1 (between "Current Sunrises/Sunsets" and "Snapshot Archive"). All existing `tabValue === N` blocks renumbered +1 |
| **OPERATING_GUIDE** | New "Snapshot retention rules" section explaining the three retention classes + how-to-enable cleanup |

---

## Architecture in one diagram

```
                    SNAPSHOT CAPTURED (Windy OR custom Pi)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌────────────┐         ┌────────────┐
       │ Binary head│         │ Regr. head │   ← cron (auto)
       └────┬───────┘         └────────┬───┘
            └────────┬─────────────────┘
                     │ Compare both outputs at score time
                     ▼
       ┌──────────────────────────────────┐
       │ model_disagreement_kind = ?      │   ← cron auto-flag
       │   binary_negative_regression_high│      (NOT a label)
       │   binary_positive_regression_low │
       │   NULL  (agreement)              │
       └──────────────┬───────────────────┘
                      │
                      ▼
        ┌─────────────────────────────┐
        │ "⚠ Hard Examples" drawer tab│   ← operator-only
        └──────────────┬──────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Click Yes / No  │   ← THIS is the label
              └────────┬────────┘
                       │
                       ▼
       ┌────────────────────────────────────┐
       │ webcam_snapshot_ratings.            │
       │   is_sunset_verdict = TRUE | FALSE  │   ← gold-standard
       │ webcam_snapshots.                   │      training labels
       │   human_sunset_majority             │      for v5
       └────────────────────────────────────┘
                       │
                       ▼
       Survives 7-day cleanup forever (retention rule #1).
       Disagreement-flagged rows survive too even before
       labeling (retention rule #2).
```

---

## Immediate next steps (in order)

### 1. Apply migration (do this first; it's safe to run before merge)

```bash
psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql
```

Verify columns exist:
```bash
psql "$DATABASE_URL" -c "\d webcam_snapshots" | grep -E "human_sunset_majority|model_disagreement_kind"
psql "$DATABASE_URL" -c "\d webcam_snapshot_ratings" | grep is_sunset_verdict
```

### 2. Open the PR

Browser: https://github.com/jessekauppila/the-sunset-webcam-map/pull/new/feat/hard-example-mining

Paste the PR description above. Title: `feat: hard-example mining + private labeling`.

### 3. Merge after Vercel preview build goes green

Vercel will auto-deploy on merge.

### 4. Walk the test plan

```bash
# Confirm cleanup is gated
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://www.sunrisesunset.studio/api/snapshots/cleanup
# Expect: {"ok":true,"deleted":0,"skipped_reason":"CLEANUP_ENABLED is false..."}

# Check disagreements are flagging (will take ~5 min of cron ticks to populate)
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM webcam_snapshots WHERE model_disagreement_kind IS NOT NULL"
# Should grow over time as Windy + custom paths score new images
```

### 5. Open the drawer, find the "⚠ Hard Examples" tab, start labeling

Click No on snapshots that aren't sunsets/sunrises. Click Yes + star rating on the ones that are. Each one becomes a gold-standard training row for v5.

---

## What's queued (future sessions)

| Project | Status | Where it lives |
|---|---|---|
| **v5 binary training using hard examples** | Blocked until you accumulate enough labels. Plan: extend `ml/export_dataset.py` with a flag to mix hard-example rows into the training set | `memory/project_two_tier_sunset_classification.md` (done — this was the prerequisite) |
| **Streamlined model deploy script** | Spec'd at `docs/superpowers/specs/2026-05-16-streamlined-model-deploy-design.md`. Plan at `docs/superpowers/plans/2026-05-16-streamlined-model-deploy.md`. Not built. Tasks 4-11 are the actual `scripts/deploy-model.sh` work. | `memory/feedback_vercel_nextjs_ml_bundling.md` covers the gotchas the script would automate |
| **Cloud wizard AR screens (Subproject F)** | Skeleton shipped in PR #21. Screens 4 (AR sun-path) and 5 (horizon sweep) are placeholders. Need brainstorming pass on compass calibration UX + library choice (three.js vs canvas2D) | `memory/project_streamlined_deployment_status.md` |
| **Pi-side alignment tool v0.3** | Spec merged at `docs/superpowers/specs/2026-05-17-pi-side-alignment-tool-design.md`. Implementation plan at `docs/superpowers/plans/2026-05-17-pi-side-alignment-tool-implementation.md`. Hardware-gated (MPU6050 chips not in hand) | Parallel session work |
| **Phase 2 winner-selection** | Spec stub in `docs/device-protocol.md` §9.4. Custom Pi cameras take ~hundreds of frames per window; need a job to pick the best. Until built, custom-cam disagreement frames are the only labeled training data from Pi cams | Out of scope of this PR — when it ships, add `is_window_winner = true` to the cleanup exclusion |
| **Hard-example dataset extraction** | Once enough labels accumulate, extend `ml/export_dataset.py` to mix the labeled hard examples into v5 training | Not yet written |

---

## Open questions / observations from the work

1. **Phase always 'sunset' for Windy disagreements.** `scoreOneWindy` runs before the sunrise/sunset classification step in the same cron tick, so we don't know the phase at insertion time. Hardcoded to 'sunset'. The Hard Examples queue doesn't filter by phase, so it's informational only — but if you ever query training data filtered by phase, this is a gap. Fix: thread the classification through, OR re-classify at insert time using subsolar position.

2. **`rating_count` hardcoded to 0 in hard-examples query.** The hard-examples branch of `app/api/snapshots/route.ts` doesn't join on `webcam_snapshot_ratings` for ratings/count display because the triage UI doesn't need it. If you later want to show "this snapshot has been rated N times" in the Hard Examples cards, add the join.

3. **No optimistic UI update on star click in the queue.** Task 11's review flagged this — the previous behavior had an optimistic `setRating()` call before the fetch. The new code drops that and waits for the server response. For a fast network this is invisible; for a slow one it feels sluggish. Future polish.

4. **`resetHardExamples()` is defined in the store but never called.** When you advance through a batch of verdicts, the stale buffer stays. The archive and curated tabs have reset triggers; hard-examples doesn't. Add a call site when you notice the staleness.

5. **No `SnapshotConsole.test.tsx`.** The plan listed it; deferred during execution because UI testing was harder. The end-to-end smoke test in Task 15 covered it instead.

---

## Tonight's session memories (recently added)

- `feedback_vercel_nextjs_ml_bundling.md` — the `outputFileTracingIncludes` route-key gotcha, smoke-endpoint latency heuristic, 250 MB bundle limit
- `feedback_normalized_vs_raw_thresholds.md` — `binary_threshold: 4.0` vs `0.75` (normalized space)
- `feedback_silent_ml_fallback.md` — surface `pathTaken` + `latencyMs` everywhere; never let the fallback path masquerade as real model output
- `project_two_tier_sunset_classification.md` — DONE; this PR ships the work

---

## Worktree state at end of session

```
~/GitHub/the-sunset-webcam-map                    [main]  ← main checkout
~/GitHub/the-sunset-webcam-map-hard-example-impl  [feat/hard-example-mining]  ← THIS PR
```

The other tonight's worktrees (`hard-example-spec`, `hard-example-plan`, `phase-aware`) were cleaned up after their PRs merged. Their branches still exist on origin if you need to revive anything.

---

## Where to start on resume

```
1. Read this file
2. Open ~/GitHub/the-sunset-webcam-map-hard-example-impl
3. git fetch origin main && git status  (confirm state)
4. Apply migration to Neon if you haven't already
5. Open the PR at the URL above
6. Merge after Vercel preview goes green
7. After deploy, walk the test plan in the PR description
8. Open the drawer, start labeling Hard Examples
```
