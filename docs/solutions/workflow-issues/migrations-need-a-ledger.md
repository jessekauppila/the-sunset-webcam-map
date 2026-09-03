---
title: Migrations need a ledger, not a rule in the spec
date: 2026-09-03
category: docs/solutions/workflow-issues
module: database/migrations
problem_type: workflow_issue
component: database
severity: high
root_cause: missing_tooling
resolution_type: tooling_addition
applies_when:
  - "A PR adds or renames a column that the cron or a route reads or writes"
  - "Deciding whether a migration file in database/migrations/ has been applied to production"
  - "Writing a migration header, a plan's deploy step, or a PR body that mentions applying SQL"
  - "The shared checkout is on main and the migration file is on a PR branch"
symptoms:
  - "A column ships in code before its migration and every write that touches the row is silently swallowed (telemetry tables lose a whole tick per tick)"
  - "Nobody can answer whether a given file in database/migrations/ has been applied without probing information_schema by hand"
  - "The only working apply helper was an untracked file in one working tree; 25 migration headers point at psql, which is not installed"
  - "node scripts/apply-migration.mjs <file> fails with ENOENT because the checkout is on main and the file is on the branch"
tags: [migrations, neon, schema-migrations, deploy-ordering, production, ledger, shared-checkout]
---

# Migrations need a ledger, not a rule in the spec

## Context

This repo has one Postgres database. Every env file points at the same Neon
endpoint, so there is no dev database and every migration applied is a
production schema change. Migrations are hand-written SQL files in
`database/migrations/`, forward-only and idempotent by convention, applied by
hand.

The rule "apply the migration BEFORE deploying the code that reads the
column" had been written into at least three specs before this doc existed
(`2026-05-14-custom-camera-popup-image-design.md` §394,
`2026-06-02-hard-example-mining-and-private-labeling-design.md` §401,
`2026-06-13-E-F-integration-contract.md` §651) and into the pool-retention
plan. It was prose each time. Nothing checked it.

On 2026-09-03 the whole-branch review of PR #123 (pool retention) found what
that costs. The new `sweep_held_ticks` column was written on every tick by
`upsertSweepStats`, whose insert sits in a `try/catch` by contract
("telemetry is never worth failing a cron tick over"). Deployed ahead of the
migration, the first statement would throw, the catch would swallow it, and
**every** sweep counter, every per-ring row, and the digest's widening line
would be lost silently, for as long as the gap lasted, right through the
window when those numbers were the Windy quota gate before a show.

Applying it then hit the other three gaps in one afternoon:

1. **No ledger.** 37 files in `database/migrations/`, zero tracking tables in
   production. "Is this applied?" meant a hand query against
   `information_schema.columns`, every PR, every time.
2. **The helper was not in the repo.** `scripts/apply-migration.mjs` was an
   untracked file written by one session on 2026-09-02, referenced by four
   migration headers. The other 25 headers said `psql "$DATABASE_URL" -f ...`,
   and `psql` is not installed on this machine.
3. **The file was on the branch; the checkout was on `main`.** Several
   sessions share one checkout and leave it on `main` when idle. Running the
   helper from `main` gave `ENOENT` because the migration only existed on
   `feat/pool-retention`. Switching a shared checkout to apply one file is
   exactly the kind of move that has stranded other sessions' work before.

## Guidance

Make the rule a mechanism. The ledger lives in production as a table, the
helper is committed and reads from any git ref, and status is one command
that fails loudly when something is pending.

**The ledger.** `schema_migrations(filename text primary key, applied_at
timestamptz, note text)`, created by the helper on first use, one row per
migration basename. It was adopted on 2026-09-03 by backfilling the 37 files
that were already in production (`note` says so) so the first status read
was honest.

**The commands** (all in `scripts/apply-migration.mjs`; pure logic in
`scripts/migration-ledger.mjs`, tested):

```bash
npm run migrate:status
# every file in database/migrations/ against the ledger; exit 1 if any is PENDING

node scripts/apply-migration.mjs database/migrations/<file>.sql
node scripts/apply-migration.mjs database/migrations/<file>.sql --apply
# dry by default; --apply runs each statement, then records the file

node scripts/apply-migration.mjs database/migrations/<file>.sql --from feat/my-branch --apply
# reads the file off a branch or commit with `git show`; nobody's checkout moves
```

**The order, in every PR that adds a column:**

1. Write the migration, forward-only and idempotent (`ADD COLUMN IF NOT
   EXISTS ... DEFAULT ...`).
2. Dry-run it, read the statement list, then `--apply` it, **from the branch,
   before the PR merges**. The PR body carries a checkbox for it.
3. `npm run migrate:status` shows it applied (or, until the branch merges,
   as an `orphan`: recorded, no file on `main` yet. That is correct.)
4. Merge and deploy.

**The migration header** points at the helper, not at `psql`:

```sql
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/<this file>.sql
--   node scripts/apply-migration.mjs database/migrations/<this file>.sql --apply
```

## Why This Matters

Writes in the cron path swallow their own errors on purpose. That contract
is right for telemetry, but it means a schema mismatch is not a crash you
notice. It is a quiet zero in a daily counter, discovered when someone reads
a digest and wonders why yesterday is missing. A rule in a spec cannot catch
that. A status command that exits 1 can, and it can gate a deploy.

The ledger also ends the re-derivation. Before it, each session that
touched a migration re-established from scratch which files were live. After
it, `migrate:status` is the answer, and `--from <branch>` removes the last
excuse for switching a checkout other sessions are using.

## When to Apply

- Any PR that adds, renames, or drops a column read by the cron or a route.
- Before every merge that carries a file in `database/migrations/`.
- When a counter, table, or digest section goes quiet after a deploy: check
  `npm run migrate:status` before reading code.
- When writing a plan or spec that says "apply before deploying": point at
  the command, not the rule.

## Examples

Before, from the pool-retention review, the failure mode as it would have
looked in `app/api/cron/update-cameras/lib/sweepStats.ts`:

```ts
try {
  await sql`insert into daily_sunset_stats (..., sweep_held_ticks, ...) values (...)`; // throws: column does not exist
  for (const ring of stats.rings) { await sql`insert into daily_sweep_ring_stats ...`; } // never runs
} catch (error) {
  console.warn('[sweepStats] persist failed:', error); // the only trace, per tick
}
```

After: the ring loop has its own `try`, and the column exists before the
code that writes it deploys, because status said so:

```
$ npm run migrate:status
  applied  20260903_sweep_failed_boxes.sql   2026-09-03 16:28  backfilled 2026-09-03: present in production before the ledger existed
  orphan   20260904_sweep_hold.sql  (in ledger, no file on disk)

All 37 migrations recorded as applied.
```

The orphan line is the PR-branch case: applied from `feat/pool-retention`
with `--from`, recorded, and it flips to `applied` when #123 merges.

## Related

- The pool-retention plan and its final review, which surfaced all four gaps:
  `docs/superpowers/plans/2026-09-03-pool-retention.md`
- `CLAUDE.md` → Commands → Migrations (the short version of this doc)
- Earlier statements of the rule as prose: the three specs cited in Context
- Shared-checkout hazards this interacts with: `feedback_never_broad_git_add`
  and `feedback_implementer_verify_branch` in the auto-memory index
