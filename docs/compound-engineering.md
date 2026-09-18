# Compound Engineering — Operating Guide

> This is the house rulebook for how we use compound engineering (CE) in this repo.
> It is Part 2 of the CE Adoption Kit; Part 1 (the one-time migration kickoff prompt) was
> run separately and is not repeated here.

> Prerequisite: the plugin is installed at user scope (`/plugin marketplace add EveryInc/compound-engineering-plugin`
> then `/plugin install compound-engineering`). That's a one-time, machine-wide step — you do **not**
> reinstall per project. The only per-project step is `/ce-setup`.

## The core loop

Compound engineering front-loads thinking: roughly **80% planning and review, 20% execution**. Each
cycle is meant to make the *next* one easier, because lessons get codified instead of relearned.

```
/ce-brainstorm  →  /ce-plan  →  /ce-work  →  /ce-code-review  →  /ce-compound  →  (repeat, sharper)
```

## Commands and when to reach for each

| Command            | Use it when…                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `/ce-strategy`     | The product direction changes, or you need to (re)establish the durable anchor in STRATEGY.md. Ideate, brainstorm, and plan all read this as grounding. |
| `/ce-ideate`       | You want bigger-picture options generated and critiqued *before* committing to one to brainstorm. Produces a ranked ideation artifact, not a plan. |
| `/ce-brainstorm`   | You have a feature or problem and need an interactive Q&A to produce a right-sized requirements doc. |
| `/ce-plan <doc>`   | You have a requirements/brainstorm doc (or an old Superpowers plan) and want a detailed implementation plan. Pass the doc path as the argument. |
| `/ce-work`         | The plan is approved and you want it executed with worktrees and task tracking.            |
| `/ce-debug`        | A bug needs systematic reproduction → root-cause → fix, instead of guessing.              |
| `/ce-code-review`  | Before merging — runs a multi-agent review.                                               |
| `/ce-compound`     | **After anything non-trivial.** Document what was learned so the next task is easier. This is the whole point; don't skip it. |
| `/ce-product-pulse`| You want a time-windowed report (24h, 7d, …) on usage, performance, errors, and followups. Saved under docs/pulse-reports/. |

## Where things live

- `STRATEGY.md` — the durable product anchor (root).
- `docs/brainstorms/` — requirements docs from `/ce-brainstorm`.
- `docs/pulse-reports/` — the browseable timeline from `/ce-product-pulse`.
- `.compound-engineering/` — CE's project config (created by `/ce-setup`).
- `CLAUDE.md` — still read by the agent; keep project-specific guidance here. It coexists with CE.

## House rules for this repo

1. **Start from STRATEGY.md.** If a feature doesn't trace back to it, question the feature or update
   the strategy first.
2. **Plan before code.** A rough idea goes through `/ce-brainstorm` (or at least `/ce-plan`) before
   `/ce-work` touches anything.
3. **Always compound.** Every non-trivial task ends with `/ce-compound`. A lesson learned and not
   written down is a lesson you'll pay for twice.
4. **Reuse, don't redo.** Existing plan docs feed `/ce-plan <path>`; existing lessons feed
   `/ce-compound`. Migration is mostly harvesting, not rewriting.

## Living alongside Superpowers (optional)

Both plugins are namespaced (`/ce-*` vs `/superpowers:*`), so commands never collide, and both can be
installed at once. The risk is that Superpowers' skills **auto-trigger from prompts**, so a Superpowers
brainstorm/review skill can fire on top of a CE one and create redundant work.

Recommended posture: **CE is the spine** (strategy, planning, compounding); borrow Superpowers
selectively for its strict TDD discipline during execution. If you notice double-triggering or noise,
disable Superpowers rather than tolerate two competing workflows. Manage either via `/plugin` →
**Installed** tab (enable/disable/uninstall).
