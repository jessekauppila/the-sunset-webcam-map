#!/usr/bin/env bash
# Mirror ml/artifacts/ to the private sunset-ml-artifacts bucket.
# A thin wrapper around `gcloud storage rsync`. See #248 and
# docs/superpowers/specs/2026-09-17-ml-artifacts-bucket-design.md.
#
#   scripts/ml-artifacts.sh push [<dir>] [--dry-run]   local -> bucket; never deletes remote objects
#   scripts/ml-artifacts.sh pull [<dir>] [--dry-run]   bucket -> local; never deletes local files
#   scripts/ml-artifacts.sh status                     sizes, and run dirs on only one side
#
# <dir> is relative to ml/artifacts/, e.g. experiments/20260831_143028_v5_binary_gold_hne8.
# Object path = repo-relative path. image_cache/ is never synced: it is a cache,
# rebuilt from frame URLs. Pruning the bucket is a deliberate `gcloud storage rm`.
#
# Operates on the checkout you run it FROM (the main checkout holds the data),
# so a worktree's copy of this script can push the main checkout's artifacts.
# ML_ARTIFACTS_BUCKET overrides the bucket name.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
LOCAL="$ROOT/ml/artifacts"
BUCKET=${ML_ARTIFACTS_BUCKET:-sunset-ml-artifacts}
REMOTE="gs://$BUCKET/ml/artifacts"
# gcloud matches --exclude as a Python regex on the path relative to the source.
EXCLUDE='^image_cache/.*|.*\.DS_Store$|.*__pycache__/.*'

usage() { sed -n '6,8p' "$0" | sed 's/^# //' >&2; exit 2; }

verb=${1:-}; shift || true
dir=""; dry=()
for a in "$@"; do
  case "$a" in
    --dry-run) dry=(--dry-run) ;;
    -*) usage ;;
    *) [ -z "$dir" ] || usage; dir=${a%/} ;;
  esac
done

case "$verb" in
  push)
    [ -z "$dir" ] || [ -d "$LOCAL/$dir" ] || { echo "no such dir: ml/artifacts/$dir" >&2; exit 1; }
    src="$LOCAL${dir:+/$dir}"; dst="$REMOTE${dir:+/$dir}"
    ;;
  pull)
    src="$REMOTE${dir:+/$dir}"; dst="$LOCAL${dir:+/$dir}"
    mkdir -p "$dst"
    ;;
  status)
    echo "local  (excl. image_cache): $(du -sk -I image_cache "$LOCAL" | cut -f1) KB"
    echo "bucket:                     $(gcloud storage du -s "$REMOTE" | awk '{print int($1/1024)}') KB"
    for kind in experiments models/binary_resnet18 models/regression_resnet18; do
      comm -3 \
        <(ls "$LOCAL/$kind" 2>/dev/null | sort) \
        <(gcloud storage ls "$REMOTE/$kind/" 2>/dev/null | sed 's#/$##; s#.*/##' | sort) \
        | awk -v k="$kind" '/^\t/ {sub(/^\t/, ""); print "  bucket only: " k "/" $0; next} {print "  local only:  " k "/" $0}'
    done
    exit 0
    ;;
  *) usage ;;
esac

echo "+ gcloud storage rsync $src $dst --recursive ${dry[*]:-}" >&2
exec gcloud storage rsync "$src" "$dst" --recursive --exclude "$EXCLUDE" ${dry[@]+"${dry[@]}"}
