# the-sunset-webcam-map — agent notes

Next.js app behind the sunrise/sunset map: web UI, snapshot ingest, ML rating
pipeline, kiosk, AR placement portal. The camera-side firmware is a separate
repo (`../sunset-cam-firmware`); wire spec is `docs/device-protocol.md`.

## Branches: one sibling worktree per feature — the main checkout is the merge desk

Every feature gets its own **git worktree in a sibling directory** and its own
cmux workspace. The main checkout (`~/GitHub/the-sunset-webcam-map`) stays on
`main`: it is where PRs merge, migrations apply, and `ml/artifacts/` lives.
Nobody edits app code there.

```bash
scripts/wt.sh new feat/mosaic-v4   # worktree + node_modules symlink + env copies + cmux workspace
scripts/wt.sh ls
scripts/wt.sh rm feat/mosaic-v4    # after the PR merges (refuses if dirty or unpushed)
```

Worktrees live at `~/GitHub/the-sunset-webcam-map.worktrees/<branch-slug>/`,
**beside** the repo, never inside it. The old `.claude/worktrees/` layout inside
the checkout is what made a worktree read as a second repo; don't recreate it.
(The firmware repo still uses that nested layout. Don't carry either
convention across.)

Inside a worktree, `next dev` picks a free port on its own, `node_modules` is a
symlink to the main checkout's, and `.env.local` / `.vercel/` are copied at
creation. Caveats (adding a dependency, stacked branches):
`docs/solutions/developer-experience/git-worktrees-for-js-and-python-repos.md`.

Still true in every worktree:

- **Verify the branch in the same command as any commit.** Worktrees make a
  wrong-branch commit rare, not impossible.
- **Stage explicit paths**, never `git add -A`.
- **Push as soon as a commit exists** and land small increments the same day.
  Long-lived branches orphan fixes:
  `docs/solutions/best-practices/integrate-frequently-dont-let-branches-sprawl.md`.
- **Remove the worktree when the PR merges.** `git worktree list` should read
  like the list of open PRs.

### Multi-session coordination

Sessions no longer share a working tree, so there is nothing to negotiate
about the checkout. What remains:

1. **Lanes:** model/measurement work (training, evals, the STATE doc) and
   display work (mosaic, kiosk) run in separate sessions. Shared helpers
   (`app/lib/modelReadout.ts`, the mosaic's `qualitySignal`) get a heads-up
   message (`ListAgents` + `SendMessage`) to the other lane when they change.
2. **The ML lane is the one exception that still works in the main checkout.**
   `ml/artifacts/` is 3 GB of mostly untracked data mixed with tracked files,
   so it can't be symlinked into a worktree. An ML session branches in the
   main checkout, and the old rules apply to it alone: ask before switching,
   return the checkout to `main` when idle, message before touching a tracked
   file there.
3. **`docs/superpowers/plans/2026-08-29-two-scale-model-STATE.md` is the
   cross-session source of truth** for the model program — read it first,
   update it on the way out.
4. **Cap active writing lanes at three.** Jesse merges every PR; more open
   worktrees than that means work outrunning review. Close idle sessions.

## Commands

```bash
npm run dev      # next dev --turbopack
npm run test     # vitest
npm run build
npm run lint
```

Backfills: `npm run backfill:archive` / `backfill:flickr` (each has a
`:dry` variant — use it first).

Migrations: `npm run migrate:status` lists `database/migrations/` against the
`schema_migrations` ledger in production and exits 1 if anything is pending.
Apply one with `node scripts/apply-migration.mjs <file> --apply` (dry by
default; `--from <branch>` reads it off a PR branch without switching the
shared checkout). There is no dev database: every `--apply` is production.
**Apply before merging the code that reads the column** — writes in the cron
swallow their own errors, so a missing column loses data silently, not loudly.
Why: `docs/solutions/workflow-issues/migrations-need-a-ledger.md`.

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
