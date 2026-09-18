---
title: CI is the first build without your env, and once required it is the merge-result gate
date: 2026-09-17
category: docs/solutions/developer-experience
module: ci
problem_type: developer_experience
component: tooling
severity: high
root_cause: config_error
resolution_type: tooling_addition
applies_when:
  - "Adding or changing .github/workflows/ci.yml"
  - "A build passes locally and on Vercel but fails in CI at Collecting page data"
  - "A module constructs a client (database, SDK) from process.env at import time"
  - "Tempted to give CI a real secret so the build or tests pass"
  - "Two green PRs could break main together"
symptoms:
  - "CI fails at next build during Collecting page data while lint and tests pass"
  - "Error: No database connection string was provided to neon()"
  - "Failed to collect page data for /api/db-all-webcams"
related_components:
  - database
  - development_workflow
  - testing_framework
tags: [ci, github-actions, next-build, env-vars, neon, import-side-effects, branch-protection, merge-verification]
---

# CI is the first build without your env, and once required it is the merge-result gate

## Context

On 2026-09-17 the repo got its first CI workflow (`.github/workflows/ci.yml`:
`npm ci` → `npm run lint` → `npx vitest run` → `npm run build`, on every PR and
every push to `main`). All three steps had been run locally first and passed:
lint clean, 2801 tests, build green. The first CI run on PR #242 still failed:

```
Error: No database connection string was provided to `neon()`.
Perhaps an environment variable has not been set?
    at .next/server/app/api/db-all-webcams/route.js
[Error: Failed to collect page data for /api/db-all-webcams]
```

`app/lib/db.ts` was `export const sql = neon(process.env.DATABASE_URL!)` at
module scope, and `neon()` throws with no connection string. `next build`
*imports* every route module to collect page data (it does not call GET
handlers), and ~54 routes import `sql`. So merely importing a route needed a
database URL, though nothing queries at build time. `/api/db-all-webcams` was
just the first importer Next reached.

Nothing had ever caught this because no build had ever run without the
variable. Locally, Next loads `.env.local` / `.env.production.local`; on Vercel,
the project's build env supplies it. The fresh CI checkout was the first build
that had neither, so "verified locally" had verified the wrong environment.

A second instance of the same class turned up the same day: issue #245, a pure
parser that could not be imported by a script because it sat behind a
server-only flag import. Both were fixed in PR #247.

## Guidance

**1. Reproduce CI's environment before trusting a local build.** Move the env
files aside, unset the variable, and restore on exit:

```bash
for f in .env.local .env.production.local .env; do [ -f "$f" ] && mv "$f" "$f.ci-bak"; done
trap 'for f in .env.local .env.production.local .env; do [ -f "$f.ci-bak" ] && mv "$f.ci-bak" "$f"; done' EXIT
env -u DATABASE_URL npm run build
```

(`.env.vercel` exists in the checkout but Next does not load it.) This is how
the fix was proven before pushing, both times: first that a dummy URL was
enough, then that no URL at all was.

**2. Construct clients on first use, never at import.** `app/lib/db.ts` now
builds the Neon client lazily behind a Proxy, so every importer is unchanged
and `sql` still works as a tagged template and exposes `sql.transaction`:

```ts
let client: NeonQueryFunction<false, false> | null = null;
function connect() {
  if (!client) client = neon(process.env.DATABASE_URL!);
  return client;
}
export const sql = new Proxy(function () {} as unknown as NeonQueryFunction<false, false>, {
  apply(_t, _this, args: unknown[]) { return (connect() as any)(...args); },
  get(_t, prop) {
    const v = Reflect.get(connect() as object, prop);
    return typeof v === 'function' ? v.bind(connect()) : v;
  },
}) as NeonQueryFunction<false, false>;
```

A missing URL still fails, at the query, with the driver's own message.

**3. The CI build step has no `DATABASE_URL` on purpose.** It carries a guard
comment:

```yaml
      # No DATABASE_URL on purpose: the build must not need one (issue #243).
      # If this step starts failing at "Collecting page data", something is
      # constructing a database client at import time again.
      - run: npm run build
```

If it fails that way again, make the new client lazy. Do not put the variable
back. The stopgap in #242 (a dummy
`DATABASE_URL: postgres://ci:ci@localhost:5432/ci` on the build step) was
acceptable only because it was fake and had an issue filed to remove it.

**4. Never give this repo's CI a real secret to make a build pass.** The repo
is public and there is no dev database: every `DATABASE_URL` is production. A
build or test that seems to need a credential has an import-time side effect.

**5. CI is a required merge gate on `main`.** After watching it pass three
times on `main`, Jesse turned on branch protection:

```
gh api -X PUT repos/jessekauppila/the-sunset-webcam-map/branches/main/protection \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=test' \
  -F enforce_admins=false \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

- The `test` job must pass before merge. A PR shows `BLOCKED` while it runs.
- `strict=true`: a PR behind `main` shows "Update branch", and CI re-runs on the
  combined code. That is GitHub enforcing "build the merge RESULT, never each
  branch alone" from
  [merged-is-a-claim-about-a-branch](../workflow-issues/merged-is-a-claim-about-a-branch.md),
  which a zero-file-overlap merge had broken twice. Cost: a ~4 minute re-run
  per PR when several land back to back, bounded by the three-lane cap.
- `enforce_admins=false` leaves Jesse an emergency bypass. Protection also
  blocks force-push and deletion of `main`.
- **Claude Code's auto-mode classifier blocks Claude from changing branch
  protection.** Hand the command to Jesse, like `vercel env add`.
- Merge queue is unavailable on a personal-account repo. Auto-merge stays off
  because Jesse reviews every PR.

## Why This Matters

A build that passes only where secrets are present is a build that cannot be
checked by anything except production. The CI run without env is now the one
place that proves a module can be imported cold, which is also what scripts,
tests and one-off tooling need (#245 was that failure seen from a script).

The merge gate turns a rule people kept having to remember into one the merge
button enforces, the same move
[migrations-need-a-ledger](../workflow-issues/migrations-need-a-ledger.md)
made for migrations.

## When to Apply

- Adding a new top-level client or SDK (Neon, Redis, Anthropic, Resend, ...):
  construct it on first use.
- A PR's CI fails at "Collecting page data" or at import in a test: look for
  module-scope construction from `process.env` before touching `ci.yml`.
- Before claiming a build works "locally": run it with the env files moved aside
  if the change touches imports or env.
- Changing CI or protection settings: protection settings go to Jesse.

What the gate does **not** cover: stacked PRs whose base is not `main`
(protection applies to `main` only), and semantic reverts that compile and pass
(shape 5 in merged-is-a-claim). Those checks stay manual.

## Examples

Maintenance on the workflow itself:

- PR #250 moved `actions/checkout` and `actions/setup-node` from v4 to v7 to
  clear the Node-20-for-actions deprecation. Read release notes before bumps:
  checkout v7 blocks fork checkout under `pull_request_target`/`workflow_run`,
  and setup-node v6+ limits auto-caching to npm. Neither applied here.
- `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19. First suspect if CI
  breaks with no code change after that date.
- CI pins `node-version: 20`; nothing in the repo pins Vercel's Node version.
  They can drift apart.
- `git push` from a Claude session can hang on an osxkeychain prompt. Push with
  `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push`
  (auto memory [claude]).

## Related

- Issues #243, #245; PRs #242 (CI + stopgap), #247 (lazy client), #250 (action
  bump), #255 (CLAUDE.md note on the gate)
- [merged-is-a-claim-about-a-branch](../workflow-issues/merged-is-a-claim-about-a-branch.md): the manual merge-result build the gate now enforces for PRs into `main`
- [dangerous-failures-here-are-silent](../best-practices/dangerous-failures-here-are-silent.md): the environment hiding a failure a clean one shows
- [stacked-branch-missing-merged-dependency](../integration-issues/stacked-branch-missing-merged-dependency.md): green tests over an import no test exercises
- [migrations-need-a-ledger](../workflow-issues/migrations-need-a-ledger.md): same move, a remembered rule becomes an enforced check
