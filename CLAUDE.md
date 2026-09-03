# the-sunset-webcam-map — agent notes

Next.js app behind the sunrise/sunset map: web UI, snapshot ingest, ML rating
pipeline, kiosk, AR placement portal. The camera-side firmware is a separate
repo (`../sunset-cam-firmware`); wire spec is `docs/device-protocol.md`.

## Branches: plain branches in the main checkout — no worktrees

Work here happens on **ordinary branches in the single main checkout**
(`git checkout -b feat/...`). Do **not** create `.claude/worktrees/` checkouts —
the extra folder reads as a separate repo and files stop appearing at their
normal paths. (The sibling firmware repo uses the opposite convention; don't
carry it over.)

If the checkout is mid-work on another branch, **ask before switching.**

Verify the branch before any commit — Jesse merges PRs in parallel and the
working branch can shift mid-task.

### Multi-session coordination (proven 2026-08-30)

Several Claude sessions share this one checkout. The protocol:

1. **Message peer sessions directly** (`ListAgents` + `SendMessage`) to
   negotiate the checkout, hand off work, or report a bug in their lane —
   don't work around each other silently.
2. **Leave the checkout on `main` when you go idle.** Whoever takes it,
   returns it.
3. **Push branches immediately** so the checkout is never the only copy of
   anyone's work; that's what makes switching safe.
4. **Lanes:** model/measurement work (training, evals, the STATE doc) and
   display work (mosaic, kiosk) run in separate sessions. Shared helpers
   (`app/lib/modelReadout.ts`, the mosaic's `qualitySignal`) get a
   heads-up message to the other lane when they change.
5. **`docs/superpowers/plans/2026-08-29-two-scale-model-STATE.md` is the
   cross-session source of truth** for the model program — read it first,
   update it on the way out.

## Commands

```bash
npm run dev      # next dev --turbopack
npm run test     # vitest
npm run build
npm run lint
```

Backfills: `npm run backfill:archive` / `backfill:flickr` (each has a
`:dry` variant — use it first).

## Deploy and env vars (Vercel)

- **Env vars bake in at deploy time.** Rotating a secret is inert until you
  redeploy. Use `vercel redeploy`, not `vercel --prod`.
- `vercel env add/rm` is classifier-blocked in Claude Code — hand those to Jesse.
- **ML bundling:** `vercel.json` `includeFiles` is silently ignored. Use
  `outputFileTracingIncludes` with **route-path** keys (`/api/...`, not
  `app/api/.../route`). Confirm a deploy actually shipped the model via the
  smoke endpoint's `latencyMs`: real ONNX is 100–500 ms, baseline fallback is
  10–20 ms. Bundle sits near the 250 MB limit.
- **Never let an ML fallback masquerade as real model output.** Persist
  `pathTaken`, surface a fallbacks counter.

## Data gotchas

- **`ai_rating` is junk** (a removed baseline heuristic). The real quality
  signal is the `llm_*` (claude-sonnet-4-5) columns; the leaderboard ranks
  `llm_quality`.
- **`binary_threshold` in `ml/` configs compares against normalized [0,1]
  labels, not raw 1–5 ratings.** "Rating ≥ 4" is `0.75`, not `4.0`. Getting
  this wrong produced the 35k-rows-zero-positives export bug.
- Postgres `NUMERIC(9,6)` serializes through the Neon driver as **strings**:
  `"lat":"47.606200"`, not a number. Flag it when smoke-testing so it doesn't
  read as a bug.
- Cameras pair via `cameras.webcam_id`, created by the **tier0 seed**, not the
  register API. Without it, snapshot POSTs 404.

## Debugging a dark or missing snapshot

Work the pipeline in order before assuming a code bug: pixel stats → EXIF →
boots/config → `snap-now.sh` on the device.

## Where knowledge lives

`docs/solutions/` holds accumulated lessons, filed by category
(`integration-issues/`, `best-practices/`, …) with YAML frontmatter — grep
`module:`, `tags:`, or `problem_type:` to find one. Also `docs/ops/`, `docs/ml/`
(incl. `rating-rubric.md`), `docs/hardware/`, `docs/plans/`. Check there before
re-deriving something.

`CONCEPTS.md` at the repo root is the shared domain vocabulary — the display
chain (Feed, Pool, Gate, Mosaic, Composition, Tile, Glass, Dial) — relevant when
orienting or naming things.

The repo root has accumulated a lot of loose planning `.md` files — treat
`docs/` as authoritative over root-level notes.
