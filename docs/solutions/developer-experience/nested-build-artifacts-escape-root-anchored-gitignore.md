---
title: Nested build artifacts slip past a root-anchored .gitignore — and how to clean a polluted PR
date: 2026-06-09
category: docs/solutions/developer-experience
module: repo-hygiene
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - A `.gitignore` rule is root-anchored (`/.next/`) but the same build output also appears in nested dirs (`.claude/worktrees/<wt>/.next/`, a submodule, a sub-package)
  - A PR turns out to carry generated artifacts or unrelated files from a stray commit
  - You want to land a clean PR without an interactive rebase (which isn't always available to agents)
tags: [gitignore, worktrees, nextjs, pr-hygiene, clean-reroll, build-artifacts, stale-main]
---

# Nested build artifacts slip past a root-anchored .gitignore — and how to clean a polluted PR

## Problem

A docs PR (cloud #23) was found, at merge time, to contain three files that didn't belong: two generated `.claude/worktrees/feat-custom-cam-visibility/.next/types/*.ts` artifacts and an unrelated scratch HTML preview — all introduced by one stray commit ("New UI for details/tooltip popup") mixed into the branch. Merging it would have dumped generated build output onto `main`.

## Symptoms

- A PR's **file list** contains generated/build files (`.next/`, `dist/`, `*.tsbuildinfo`) or files unrelated to the PR's stated purpose.
- `git check-ignore` on those paths returns nothing, even though you "have a `.next/` rule."

## Root Cause

Two gitignore gaps:

1. **Root-anchoring.** `/.next/` (leading slash) matches `.next/` only at the repo root. A `.next/` produced inside a nested working dir — e.g. `.claude/worktrees/<wt>/.next/` — is *not* matched.
2. **Wrong worktree path.** Only `.worktrees/` was ignored, not `.claude/worktrees/` (where the harness places agent worktrees, each with its own `.next/` build output).

## Solution

### Harden the ignore (cloud #56)

```gitignore
# next.js
/.next/
**/.next/          # nested build output anywhere (worktrees, sub-packages)

# claude worktrees (each carries its own .next/ build output)
.claude/worktrees/
```

Verify with the actual offending paths before trusting it:

```bash
git check-ignore .claude/worktrees/x/.next/types/routes.d.ts   # should print the path (ignored)
```

### Re-roll the polluted PR clean (cloud #23 → #55)

Interactive rebase to drop the stray middle commit isn't always available (and rewriting a shared branch is risky). Simpler: **rebuild the branch with only the wanted file(s)**, off fresh `main`:

```bash
git checkout -b docs/<feature>-clean origin/main
git checkout origin/<polluted-branch> -- path/to/the/one/file/you/want.md
git add path/to/the/one/file/you/want.md && git commit
git push -u origin docs/<feature>-clean
# open the new PR; close the polluted one pointing at it
```

This grabs the final state of just the file(s) you want and leaves every artifact and unrelated change behind — no history surgery.

## Prevention

- **Review a PR's file *list*, not just its title/diff summary, before merging.** The junk here was invisible unless you looked at which paths changed.
- **Anchor build-output ignores with `**/`** when the tool can run in nested dirs (worktrees, monorepo packages).
- **Watch for stale local refs when collaborators merge in parallel.** Separately this session, `next.config.ts` appeared "reverted" on a freshly-created branch — the cause was a local `origin/main` that was 2 commits behind a teammate's merge. `git fetch` before trusting a working-tree diff or basing a branch; see `memory/feedback_implementer_verify_branch`.
