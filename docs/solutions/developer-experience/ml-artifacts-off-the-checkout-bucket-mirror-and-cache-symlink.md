---
title: "Keeping ML artifacts off the checkout: bucket mirror plus cache symlink"
date: 2026-09-17
category: docs/solutions/developer-experience/
module: ml/artifacts
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - "Large untracked artifacts pin a workflow to one checkout and block worktrees"
  - "Run or experiment dirs are named once and never rewritten"
  - "A rebuildable cache lives inside the repo under a path many configs hardcode"
symptoms:
  - "ML lane exempt from the sibling-worktree rule because ml/artifacts is 3.2 GB"
  - "best.pt checkpoints existed only on one Mac with no backup"
root_cause: missing_tooling
resolution_type: tooling_addition
tags: [gcs, gcloud-rsync, ml-artifacts, worktrees, symlink, gitignore, backup, dvc]
---

# Keeping ML artifacts off the checkout: bucket mirror plus cache symlink

## Context

`ml/artifacts/` was 3.2 GB inside the main checkout. A worktree had none of the
untracked bulk, so it could not train or warm-start. That made the ML lane the one
exception to the sibling-worktree rule (issue #248). Measured 2026-09-17:

| What | Size | Git | Nature |
|---|---|---|---|
| `image_cache/` | 1.5 GB, 52,276 jpgs | ignored | Cache keyed by frame-URL hash, rebuildable |
| `experiments/*/train/best.pt` | 27 × ~43 MB | ignored | **The only copy, no backup** |
| `models/*/model.onnx` | 10 × 43 MB | tracked | Most of the ~1 GB pack; two are deployed |
| manifests, reports, ratings CSVs | ~350 small files | tracked | Reviewable, belong in git |

## Guidance

**Sort artifacts by their nature before choosing where they live.** A cache
leaves the repo and is not backed up. Sole-copy outputs go to a bucket. Deployed
models and small reviewable files stay in git.

**Mirror dirs that never change after they're written, with `gcloud storage rsync`.**
Experiment and model dirs are named `<YYYYMMDD>_<HHMMSS>_<run>` and never
rewritten, so there is nothing to version:

- DVC is built for data that changes under a stable name, and it would fight the
  deliberately mixed tracked/ignored layout.
- Upload-as-you-write makes every writer bucket-aware and leaves local paths
  behind when an upload fails.

A mirror is one wrapper script, `scripts/ml-artifacts.sh push|pull|status`, over a
private bucket. The wrapper works on the checkout it is run *from*
(`git rev-parse --show-toplevel`), so a branch's copy can push the main
checkout's data before the branch merges.

**Keep deployed ONNX in git.** Vercel bundles them through the `.vercelignore`
whitelist and `outputFileTracingIncludes`. Fetching them at build time would add
a network dependency right next to the 250 MB bundle limit, which is a silent
fallback waiting to happen. See
[vercel-bundles-all-model-versions-near-size-limit](../integration-issues/vercel-bundles-all-model-versions-near-size-limit.md).

**Move the cache out and symlink it back.** It now lives at
`~/.cache/sunset-ml/image_cache`, and `ml/artifacts/image_cache` is a link to it.
`scripts/wt.sh new` creates the same link beside the `node_modules` one. The
path is hardcoded in `run_experiment.py`, `evaluate.py` and 21 configs, and the
symlink keeps all of them correct without editing any.

## Why This Matters

- The only trained weights were one disk failure away from gone.
- A worktree could not do ML work, which forced a shared-checkout exception and
  the coordination overhead that comes with it.
- A cache has no reason to be backed up. Uploading it pays for storage to save a
  re-download.

## When to Apply

- Large untracked outputs that a worktree or second machine needs.
- Output dirs named by time or id and never rewritten. Use a mirror, not a
  versioning tool.
- A cache whose path is hardcoded in many places. Symlink it instead of editing
  every config.

## Examples

```
gcloud storage buckets create gs://sunset-ml-artifacts \
  --location=us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Moving the cache. Both paths are on the same disk, so the `mv` is a rename:

```
mkdir -p ~/.cache/sunset-ml
mv ml/artifacts/image_cache ~/.cache/sunset-ml/image_cache
ln -s ~/.cache/sunset-ml/image_cache ml/artifacts/image_cache
```

Verified on 2026-09-17:
- Bucket and local both had 484 files and 27 of 27 `best.pt`.
- Sizes were within 0.06%, which is block rounding.
- From a fresh worktree, 1,455 of 1,455 v5 validation frames resolved through
  the link.

### Gotchas hit along the way

**A gitignore `dir/` pattern does not match a symlink.** After the move, git
showed `?? ml/artifacts/image_cache`. Drop the slash: `ml/artifacts/image_cache`.
It's the same kind of surprise as
[nested-build-artifacts-escape-root-anchored-gitignore](nested-build-artifacts-escape-root-anchored-gitignore.md).

**A `gcloud storage rsync --exclude` regex crashed gcloud.** This pattern:

```
^image_cache/.*|(^|.*/)\.DS_Store$|(^|.*/)__pycache__/.*
```

gave `gcloud crashed (PatternError): unbalanced parenthesis at position 4` on
gcloud 585.0.0. Figment's own parenthesized pattern dry-ran fine on the same
version, and the cause was not isolated. This paren-free form works:
`^image_cache/.*|.*\.DS_Store$|.*__pycache__/.*`. Always `--dry-run` a new
exclude before a real push.

**Two uploads sharing one connection drop files.** Figment's `runs/` push ran at
the same time, and about 21 files failed with
`Max retries exceeded ... Failed to establish a new connection` or
`The write operation timed out`. rsync only sends what's missing, so a plain
rerun filled the gaps. Check success by counting files, not by the exit status:

```
find ml/artifacts -path ml/artifacts/image_cache -prune -o -type f -print | wc -l
```

```
gcloud storage ls 'gs://sunset-ml-artifacts/ml/artifacts/**' | wc -l
```

**`grep -c` exits 1 on zero matches.** A background task ending in
`grep -c ERROR log` was reported "failed" even though the push printed `rc=0` and
there were no errors. Read the printed rc, or end the command with `|| true`.

**The keychain push hang struck two repos at once.** It's the incident in
[dangerous-failures-here-are-silent](../best-practices/dangerous-failures-here-are-silent.md):
a 401 falls through to a keychain prompt that nothing can answer. This time it
left four figment commits sitting on local `main` only, one push stuck about 57
minutes. The two-flag push cleared both repos:
`GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.

## Related

- Issue #248. Specs: `docs/superpowers/specs/2026-09-17-ml-artifacts-bucket-design.md`
  (sunset) and figment `docs/superpowers/specs/2026-09-17-run-storage-bucket-design.md`.
  Figment mirrors `runs/` the same way.
- [git-worktrees-for-js-and-python-repos](git-worktrees-for-js-and-python-repos.md) covers
  the same symlink-a-shared-dir pattern, for `node_modules`.
- Still open: ONNX ignored by default (step 3), and the ML Python venv reachable
  from a worktree before the CLAUDE.md exception can go (step 4).
