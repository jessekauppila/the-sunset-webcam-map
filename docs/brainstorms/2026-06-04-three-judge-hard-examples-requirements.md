---
date: 2026-06-04
topic: three-judge-hard-examples
---

# Three-Judge Hard Examples + Verification + Leaderboard Rating

## Summary

Make the Hard Examples queue actually work by scoring every frame with **three judges** — the v4 binary head, the v4 regression head, and Claude (`claude-sonnet-4-5`) — and surfacing their **disagreements** for the operator to verdict, ranked **model-vs-Claude** (Claude as the trusted reference). Run all three over the webcam archive (~33k) and an ingested Flickr set. Add a private **verification** surface that shows all three ratings side by side, fix the public **Best Sunsets** leaderboard to rank by Claude (model as fallback, all ratings shown) with **Flickr excluded**, and keep flagging binary-vs-regression disagreements on live frames going forward. Operator verdicts become v5's gold labels.

## Problem Frame

The Hard Examples queue is empty — `model_disagreement_kind` is set on 0 of 33,099 snapshots. The reason is structural: a hard example needs two opinions to disagree, and right now there's only **one** trustworthy opinion. Claude has analyzed ~29,705 archive frames (`llm_quality`, `llm_is_sunset`, etc.), but the **v4 model never scored the archive** (`webcam_snapshots.ai_rating` is a junk legacy column — 0 rows have a regression score or model version), and the binary head isn't even enabled in Vercel prod, so the cron has never flagged a live disagreement either. There's nothing to disagree about.

The v4 model has knowable blind spots (the Taltson River silhouette case, 2026-06-02 — an obvious sunset the binary head called "not a sunset"). v5 needs labeled hard examples to learn from, and the strongest way to find them is to pit the model against a trusted judge (Claude) and have the operator verdict the gaps. See origin: `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md` and the `project_snapshot_rating_provenance` memory note.

## Key Decisions

- **Three judges, Claude as the trusted reference.** Compare the v4 binary head, v4 regression head, and Claude. Hard examples rank **model-vs-Claude first** (Claude says spectacular sunset / model scored low = a miss; model scored high / Claude says not-a-sunset = a false positive). Binary-vs-regression internal split is a secondary, lower-priority kind.
- **Run v4 over the archive (one-time backfill) — the unlock.** Scoring the ~33k archive with both heads gives a real model opinion to disagree with, and replaces the junk `ai_rating` with a genuine value as a bonus.
- **Flickr is ingested but private-only.** Flickr images enter the system tagged `source='flickr'`, scored by all three judges, and surface **only** in the operator's private surfaces (Hard Examples + Verification) — **never** the public leaderboard.
- **Public leaderboard: Claude-primary, model fallback, all ratings shown.** Rank by Claude's quality when present (most accurate); fall back to the regression rating when Claude is absent; show the binary verdict + regression + Claude on each card. Webcam archive only.
- **Verification and Hard Examples share one backbone.** Same three-judge data; Verification browses all ratings, Hard Examples is the disagreement subset you verdict. Whether they're one tab with a "disagreements only" toggle or two tabs is a planning/UX call.
- **Phased delivery** (see Phasing) — leaderboard rating fix first, then the archive backfill + queue, then Flickr + verification last.

## Actors

- A1. **Operator (Jesse)** — verdicts hard examples (gold labels), uses the verification tool to eyeball how the three judges compare. Login-gated.
- A2. **Public viewer** — sees the Best Sunsets leaderboard (archive only, no Flickr).
- The three **judges** are systems, not actors: v4 binary head, v4 regression head, Claude.

## Requirements

**Three-judge scoring**
- R1. Frames in scope carry all three judge outputs: the v4 binary verdict, the v4 regression rating, and Claude's verdict + quality (`llm_*`).
- R2. The v4 model (binary + regression) is run over the full webcam archive as a one-time backfill, writing real per-snapshot model scores (replacing the junk `ai_rating`).
- R3. Going forward, the cron scores live frames with both heads (binary enabled in prod) and flags binary-vs-regression disagreements (today's mechanism).

**Hard Examples queue**
- R4. A hard example is a frame where the judges disagree, ranked **model-vs-Claude first**; binary-vs-regression split is a secondary kind.
- R5. The queue surfaces the highest-value disagreements first (largest model-vs-Claude gap); the operator pages through.
- R6. The operator verdicts each frame (is_sunset yes/no; quality stars on "yes"). The verdict is the gold label and removes the frame from the queue.
- R7. The queue draws from both the webcam archive and the Flickr set (the unified training pool).

**Verification surface**
- R8. A private, operator-only verification view shows all three ratings side by side per frame (binary verdict, regression rating, Claude verdict+quality) — a model-eval / "dummy-check" tool.
- R9. Verification and Hard Examples share one data backbone; one-tab-with-toggle vs two tabs is a planning/UX decision.
- R10. The verification surface includes Flickr frames as well as the archive.

**Public Best Sunsets leaderboard**
- R11. The public leaderboard shows the **webcam archive only** — Flickr frames are excluded.
- R12. Ranking uses Claude's quality when present, falling back to the regression rating when Claude is absent.
- R13. Each card shows all available ratings: the v4 binary verdict, the regression rating, and Claude's verdict + quality.

**Flickr ingestion**
- R14. Flickr images are ingested tagged `source='flickr'`, scored by all three judges, and surfaced only in the private operator surfaces — never the public leaderboard.
- R15. Claude analysis is run over the Flickr set (where not already present) so all three judges cover it.

**v5 feed**
- R16. Operator verdicts accumulate as gold labels (is_sunset + quality) usable for v5 training. Actual dataset export / training is deferred.

## Key Flows

- F1. **Archive backfill** — run v4 (both heads) over the ~33k archive → store model scores → compute disagreement vs Claude → the Hard Examples queue fills. **Covers R2, R4.**
- F2. **Operator verdict** — open Hard Examples → top model-vs-Claude disagreement shows with all three ratings → Yes/No (+ stars on Yes) → gold label persists, frame leaves the queue. **Covers R5, R6.**
- F3. **Live flagging** — cron scores a live frame with both heads → binary-vs-regression disagreement → flagged into the queue. **Covers R3.**
- F4. **Verification browse** — operator opens the verification view → sees every frame's three ratings (archive + Flickr), can filter to disagreements. **Covers R8, R10.**

## Scope Boundaries

**Deferred for later**
- v5 dataset export + actual training (`ml/export_dataset.py` integration) — collect labels first.
- Multi-rater majority semantics — single operator today.
- One-tab-with-toggle vs two-tabs — a planning/UX decision, not a product fork.

**Outside this product's identity**
- Flickr / training data on the public surface — never. The public board is real webcam sunsets only.

## Dependencies / Assumptions

- **Batch inference at scale.** Scoring ~33k archive + Flickr with both ONNX heads is a one-time batch job — likely a script / `ml/` job rather than the serverless cron, given Vercel bundle/time limits (the ONNX bundle already hovers near the 250 MB cap). Mechanism is a planning decision.
- **Claude over Flickr is Anthropic API spend** — running `claude-sonnet-4-5` over the Flickr set has real cost; quantify before running.
- **Flickr storage shape** — Flickr frames aren't webcams (no `webcam_id`/location); they need to be first-class snapshots with `source='flickr'` and somewhere their images are served from. Storage/schema is a planning decision.
- **Private surfaces must be operator-gated** — the verification + hard-examples tabs reuse the owner auth (`requireOwner`, shipped in the auth PR).
- **Binary head enabled in Vercel** (`AI_BINARY_SCORING_ENABLED=true`) is required for live (F3) flagging.

## Open Questions

**Deferred to planning**
- One tab with a "disagreements only" toggle vs two separate tabs (Verification vs Hard Examples).
- Backfill mechanism (standalone script vs paged admin endpoint vs `ml/` job) and how it handles the ~33k + Flickr volume + cost.
- How Flickr images are stored and served (and whether they live in `webcam_snapshots` with `source='flickr'` or a parallel table the queries union).
- The exact 3-judge disagreement-kind taxonomy + thresholds, and the prioritization scoring formula (largest model-vs-Claude gap).

## Phasing

| Phase | Scope | Rationale |
|---|---|---|
| 1 | Leaderboard rating: Claude-primary, show model ratings, regression fallback, exclude Flickr | Small, immediate; the board already ranks Claude — add model display + fallback + the Flickr guard |
| 2 | Backfill v4 (binary+regression) over the 33k archive → model-vs-Claude **Hard Examples** queue + verdict flow | The real unlock; fills the queue with the model's actual errors |
| 3 | Flickr ingestion (`source='flickr'`, all three judges) + private **Verification** tab | Biggest lift; comes last |
| ongoing | Enable binary in Vercel → live binary-vs-regression flagging | One env var |

## Sources / Research

- `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md` — the original hard-example design (binary-vs-regression on live frames).
- `STRATEGY.md` — Track 1 (ML quality & sunrise/sunset detection).
- `project_snapshot_rating_provenance` memory — `ai_rating` is junk; `llm_*` is the real signal; queue empty because binary not in Vercel.
- Verified data: 33,099 snapshots; 28,528 with junk `ai_rating`; 29,705 with Claude analysis; 0 disagreement-flagged; ~4,691 borderline-quality sunsets.
- Code: `app/api/cron/update-cameras` (`computeDisagreementKind`, scoring), `app/api/leaderboards`, `app/components/Leaderboard/LeaderboardTab.tsx`, `app/components/SnapshotConsole.tsx` (`mode="hard-examples"`), `ml/flickr_scraper.py`, `ml/export_dataset.py`.
