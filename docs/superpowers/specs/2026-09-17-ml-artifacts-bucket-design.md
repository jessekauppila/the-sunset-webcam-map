# ml/artifacts bulk to a bucket

Date: 2026-09-17. Issue: #248. Status: design approved, not built.
Sister design: `~/GitHub/figment/docs/superpowers/specs/2026-09-17-run-storage-bucket-design.md`
applies the same approach to figment's `runs/`. Figment goes first because it has no
production stakes. Lessons from it carry over here.

## Why

`ml/artifacts/` is 3.2 GB in the main checkout, and it is the reason the ML lane
is the one exception to the sibling-worktree rule in `CLAUDE.md`. The data it
holds (measured 2026-09-17):

| What | Size | In git? | Nature |
|---|---|---|---|
| `image_cache/` | 1.5 GB, 52k jpgs | ignored | A cache, keyed by frame-URL hash, rebuildable |
| `experiments/*/train/best.pt` | ~43 MB each, ~27 files | ignored | **The only copy, on one Mac, no backup** |
| `models/*/model.onnx` | 43 MB each, 10 files | tracked | Most of the ~1 GB git pack; two are deployed |
| manifests, reports, ratings CSVs, metrics | ~350 files, tens of MB | tracked | Small, reviewable, belong in git |
| `20260831_143028_v5_binary_gold_hne8` experiment + model dirs | — | untracked strays | Never committed |

Three problems follow. The checkpoints can be lost. A worktree can't train,
because it lacks the cache and the checkpoints it would warm-start from. And every
exported model adds 43 MB to git history forever.

## Decision

**Mirror the ignored bulk to a private GCS bucket with `gcloud storage rsync`.
Move the image cache out of the repo instead of uploading it. Deployed ONNX
models stay in git.**

Mirroring is enough because experiment and model directories are named
`<YYYYMMDD>_<HHMMSS>_<run_name>` and never rewritten after the run. With no
in-place edits there is nothing to version, so a pointer-file tool like DVC
would add machinery without adding value. `gcloud` is a prebuilt tool: this
design is one wrapper script, one symlink, and a doc change.

Rejected:
- **DVC.** It is built for data that changes under a stable name. It would also
  fight the mixed tracked/ignored layout that `.gitignore` sets up on purpose
  ("surgical exclusions only").
- **Fetching the deployed ONNX from the bucket at build time.** It would add a
  network dependency to every Vercel build, next to a bundle that already sits
  near the 250 MB limit. A failed fetch is exactly the kind of silent
  fallback `CLAUDE.md` warns about. The `.vercelignore` whitelist and
  `outputFileTracingIncludes` keep working unchanged.
- **Shrinking git history.** It needs a history rewrite, which is blocked, and
  the pack's size costs nothing day to day.
- **Uploading the image cache.** It is rebuilt from frame URLs by the existing
  `precache` step. Backing up a cache pays storage to save a re-download.

## Design

### Bucket

`sunset-ml-artifacts`, private, in the existing Firebase GCP project (the one
`FIREBASE_STORAGE_BUCKET` lives in). Object path = repo-relative path, so
`gs://sunset-ml-artifacts/ml/artifacts/experiments/<run>/train/best.pt`. No
public access: nothing here is served.

### `scripts/ml-artifacts.sh`

A thin wrapper around `gcloud storage rsync`, scoped to `ml/artifacts/` and
excluding `image_cache/`:

```
scripts/ml-artifacts.sh push [<run-dir>]   # local -> bucket; never deletes remote objects
scripts/ml-artifacts.sh pull [<run-dir>]   # bucket -> local; never deletes local files
scripts/ml-artifacts.sh status             # local vs remote size, and runs that exist on only one side
```

- `push` with no argument uploads everything not yet in the bucket, tracked
  files included. Tracked files are small, and a complete bucket is easier to
  reason about than one that assumes git holds the rest.
- `pull <run-dir>` fetches one experiment or model directory. That is the
  worktree case: fetch the checkpoint a warm-start needs, not 1 GB.
- No delete flag. Pruning is a deliberate manual `gcloud storage rm`.
- Paste-safe: every line in its usage text is a single short command.

### The image cache leaves the repo

It moves to `~/.cache/sunset-ml/image_cache`. `ml/artifacts/image_cache`
becomes a symlink to it, both in the main checkout and in every worktree that
`scripts/wt.sh new` creates, the same way it already symlinks `node_modules`.
The path is hardcoded as a default in `ml/run_experiment.py`, `ml/evaluate.py`
and 21 configs. The symlink keeps every one of them correct without editing
any. One cache is shared by all worktrees, so a frame is downloaded once per
machine.

### New models

After this lands, `export_onnx_versioned.py` output is ignored by default:
`ml/artifacts/models/**/model.onnx` goes into `.gitignore`. The model being
deployed is committed with `git add -f`, in the same PR that adds its
`.vercelignore` `!` line. That way git holds deployed models, the bucket holds
every model, and the two can't be confused. The 10 already-tracked files stay
tracked, because ignore rules do not untrack existing files.

### Auth

Jesse, once: `brew install google-cloud-sdk`, then `! gcloud auth login` (it's
interactive) and `gcloud config set project <firebase project id>`. Both `push`
and `pull` need credentials, because the bucket is private.

## Order of work

1. **Backup (stands alone, do it first).** Create the bucket and write
   `scripts/ml-artifacts.sh`. Run `push` from the main checkout: every
   `best.pt`, all ONNX, the hne8 strays. Check it with `status`.
2. **Cache out of the repo.** Move the directory, add the symlink, and teach
   `scripts/wt.sh new` to create the symlink.
3. **New models ignored by default.** The `.gitignore` line, and a note in
   the `.gitignore` passage of `ml/OPERATING_GUIDE.md` on `git add -f` for
   deployed models.
4. **Retire the exception.** Remove "The ML lane is the one exception…" from
   `CLAUDE.md`. Replace it with: an ML session uses a worktree like everyone
   else, runs `pull <run>` before warm-starting, and runs `push` after a run
   finishes.

Each step is its own small PR.

## Testing

- After step 1: `status` reports no local-only runs, and remote size is within a
  few percent of `du` on `ml/artifacts/` minus `image_cache/`.
- After step 2: in a fresh worktree, `ml/artifacts/image_cache` resolves, and a
  pilot run (`subset.max_train_samples` small) finds its frames in the cache
  without downloading them.
- After step 4: in a fresh worktree, `pull` one experiment, export its ONNX with
  `export_onnx_versioned.py`, and confirm it scores a handful of frames the same as the committed
  `model.onnx` (export is not byte-deterministic, scores are). That proves the round trip.

## Out of scope

- Moving the ML lane's training compute off the Mac. Separate question. The
  bucket makes it possible later but doesn't require it.
- Experiment tracking UIs (W&B, MLflow). `compare_experiments.py` and
  `public/ml-runs/` cover it today.
- Retention. At a few GB, the bucket costs well under a dollar a month.
