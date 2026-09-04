#!/usr/bin/env bash
# One sibling worktree per feature. See CLAUDE.md "Branches".
#
#   scripts/wt.sh new <branch> [base]   create worktree + node_modules symlink
#                                       + env/.vercel copies + cmux workspace
#   scripts/wt.sh rm  <branch>          remove the worktree (branch is kept)
#   scripts/wt.sh ls                    list worktrees
#
# Worktrees live BESIDE the repo, never inside it:
#   ~/GitHub/the-sunset-webcam-map.worktrees/<branch-with-slashes-as-dashes>/
set -euo pipefail

ROOT=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
WT_DIR="${ROOT}.worktrees"

slug_of() { printf '%s' "$1" | tr '/' '-'; }

cmd=${1:-}
case "$cmd" in
  new)
    branch=${2:-}
    [ -n "$branch" ] || { echo "usage: scripts/wt.sh new <branch> [base]" >&2; exit 1; }
    base=${3:-origin/main}
    path="$WT_DIR/$(slug_of "$branch")"
    [ ! -e "$path" ] || { echo "already exists: $path" >&2; exit 1; }
    mkdir -p "$WT_DIR"
    git -C "$ROOT" fetch -q origin

    if git -C "$ROOT" show-ref --verify -q "refs/heads/$branch"; then
      git -C "$ROOT" worktree add "$path" "$branch"
    elif git -C "$ROOT" show-ref --verify -q "refs/remotes/origin/$branch"; then
      git -C "$ROOT" worktree add --track -b "$branch" "$path" "origin/$branch"
    else
      git -C "$ROOT" worktree add -b "$branch" "$path" "$base"
    fi

    # Shared deps: a new dependency installs into the shared node_modules,
    # which is fine — package.json/lock changes stay on the branch.
    ln -s "$ROOT/node_modules" "$path/node_modules"
    for f in .env.local .env.production.local .env.vercel; do
      [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$path/$f"
    done
    [ -d "$ROOT/.vercel" ] && cp -R "$ROOT/.vercel" "$path/.vercel"

    # cmux prints "OK workspace:N"; rename by ref — a bare rename-workspace
    # hits whichever workspace is focused, i.e. the one you ran this from.
    if [ -n "${CMUX_SOCKET_PATH:-}" ] && command -v cmux >/dev/null; then
      ws=$(CMUX_QUIET=1 cmux new-workspace --cwd "$path" | awk '{print $2}')
      [ -n "$ws" ] && CMUX_QUIET=1 cmux rename-workspace --workspace "$ws" "$branch" >/dev/null
    fi
    echo "$path"
    ;;
  rm)
    branch=${2:-}
    [ -n "$branch" ] || { echo "usage: scripts/wt.sh rm <branch>" >&2; exit 1; }
    path="$WT_DIR/$(slug_of "$branch")"
    if [ -n "$(git -C "$path" status --porcelain)" ]; then
      echo "worktree is dirty, not removing: $path" >&2; exit 1
    fi
    if ! git -C "$ROOT" branch -r --contains "$branch" >/dev/null 2>&1 || \
       [ -z "$(git -C "$ROOT" branch -r --contains "$branch" 2>/dev/null)" ]; then
      echo "branch $branch has commits not on any remote — push first" >&2; exit 1
    fi
    git -C "$ROOT" worktree remove "$path"
    git -C "$ROOT" worktree prune
    echo "removed $path (branch $branch kept; delete it after the PR merges)"
    ;;
  ls)
    git -C "$ROOT" worktree list
    ;;
  *)
    sed -n '2,10p' "$0" >&2; exit 1
    ;;
esac
