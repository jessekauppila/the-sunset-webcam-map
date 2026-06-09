---
title: Stacked feature branch missing a dependency that merged to main after it was cut
date: 2026-06-08
category: docs/solutions/integration-issues
module: dev-workflow
problem_type: integration_issue
component: development_workflow
symptoms:
  - "A function/symbol exists on main but ImportErrors at runtime/deploy from a feature branch"
  - "Unit tests pass because the import is in an un-exercised entrypoint (a launcher/script), not a tested module"
  - "`git merge-base --is-ancestor origin/main <branch>` reports the branch is NOT a descendant of main"
root_cause: incomplete_setup
resolution_type: workflow_improvement
severity: high
tags: [git, branches, stacked-prs, dependencies, deploy, importerror, raspberry-pi]
---

# Stacked feature branch missing a dependency that merged to main after it was cut

## Problem

A feature branch cut off `main` (or off another feature branch) **before** a dependency PR merged does not contain that dependency. Everything looks fine — the code references the symbol, unit tests are green — but it `ImportError`s the moment the real entrypoint runs (deploy, or a script the tests never import). This bit the sunset-cam firmware **twice in one session**: both `feat/v0.4-sun-tap-aiming` and `feat/deploy-aiming-supervisor` referenced `make_orientation_reader` (from the gyro fix, PR #4) in `scripts/run-setup-server.py`, but were cut before #4 merged to `main` — so the launcher would have died on import on the Pi.

## Symptoms

- The symbol exists on `main` (`git show origin/main:path | grep 'def thing'` → found) but not on the branch (count 0).
- `git merge-base --is-ancestor origin/main <branch>` → **not** an ancestor (main isn't merged in).
- Unit tests pass — because the broken import lives in a **launcher/script** (`run-setup-server.py`) that the test suite never imports. A green suite hid it.

## What Didn't Work

- **Trusting green unit tests.** They prove the tested modules import and behave; they say nothing about an entrypoint script the suite doesn't load. The gap was invisible until someone reasoned about the deploy (or until deploy itself).

## Solution

Before deploying or merging a stacked branch, do two checks:

1. **Resolve the real import chain**, including the entrypoints tests skip:
   ```bash
   python3 -c "import sys; sys.path.insert(0,'src'); \
     from sunset_cam.gyro_driver import make_orientation_reader; \
     from sunset_cam.setup_server import AimingService; \
     from sunset_cam import supervisor; print('chain OK')"
   ```
2. **Confirm the dependency is actually present** / main is merged in:
   ```bash
   git merge-base --is-ancestor origin/main <branch> && echo MERGED || echo "main not in branch"
   ```
   If a dependency landed on main after the branch was cut, **merge it in**: `git merge origin/main --no-edit` (clean when the branch didn't touch the dependency's files).

## Why This Works

Stacked branches snapshot their base at cut time; later merges to that base don't propagate. The import only fails at the seam the test suite doesn't cover (the entrypoint). Explicitly exercising the entrypoint's import chain + verifying ancestry surfaces the drift before it reaches hardware.

## Prevention

- **Cut a branch off its actual dependency**, not off `main`, when a needed PR is still open. (Or rebase/merge the dependency in as soon as it lands.)
- **Add an import-chain smoke check** to the pre-deploy step — `python3 -c "import <entrypoint chain>"` — so launcher-only imports are exercised even when no unit test loads them.
- A **walking-skeleton run** (deploy + run the real entrypoint early) catches this class of bug structurally — see [[walking-skeleton-over-horizontal-buildout]].

## Related Issues
- `../integration-issues/mpu6050-reads-fake-zeros-when-asleep.md` — the gyro `wake()`/`make_orientation_reader` fix (PR #4) that was the missing dependency here.
