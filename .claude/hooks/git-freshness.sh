#!/usr/bin/env bash
# SessionStart hook: fetch, then report ONLY if this checkout is behind origin.
#
# Why this exists: on 2026-09-02 a session designed a feature that had shipped
# the night before, because its checkout was 42 commits stale. A worktree would
# have been equally stale — the fix is knowing, not isolating.
#
# Silent when the tree is current, so the common case costs no context.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Never let an auth prompt block the session opening.
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true SSH_ASKPASS=true
git fetch --quiet --all >/dev/null 2>&1 || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
notes=""

# How far the current branch trails its own upstream, when it has one.
if upstream=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null); then
  behind=$(git rev-list --count "HEAD..$upstream" 2>/dev/null || echo 0)
  [ "${behind:-0}" -gt 0 ] && notes="$branch is $behind commit(s) behind $upstream."
fi

# How far local main trails origin/main — the one that causes duplicated work,
# since it is what a new branch would fork from. Skipped when main IS the
# current branch, because the upstream check above already said it.
if [ "$branch" != "main" ] &&
   git rev-parse --verify --quiet main >/dev/null 2>&1 &&
   git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  mb=$(git rev-list --count main..origin/main 2>/dev/null || echo 0)
  if [ "${mb:-0}" -gt 0 ]; then
    [ -n "$notes" ] && notes="$notes "
    notes="${notes}Local main is $mb commit(s) behind origin/main."
  fi
fi

[ -z "$notes" ] && exit 0

printf '%s' "$notes" | jq -Rs '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("Git freshness: " + . + " Pull or read origin/main before planning any new work — a stale tree is how features get designed twice.")
  }
}'
