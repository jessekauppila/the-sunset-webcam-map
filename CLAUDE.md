# CLAUDE.md — Sunrise/Sunset

Guidance for agents working in this repo. Start here, then read `STRATEGY.md` for the
durable product anchor.

## What this is
**Sunrise/Sunset** — a live map and project hub anchored on the day/night terminator
that surfaces webcams near sunrise/sunset and rates each frame's sky quality with an ML
model, so the map shows "cameras with a *good* sunset right now," not just "cameras near
sunset." It is equal parts working product and art (the first installation is a
quality-scaled kiosk mosaic). Two camera sources feed one pipeline: public webcams
(Windy etc.) and custom Raspberry Pi cameras. See `STRATEGY.md` for vision, personas,
metrics, and the tracks of work.

## Stack
- **Web:** Next.js (app router, Turbopack), React, TypeScript, MUI + Emotion, Tailwind.
- **Map/viz:** deck.gl + Mapbox GL; `suncalc` / `solar-calculator` for terminator math.
- **Data:** Neon serverless Postgres (`@neondatabase/serverless`, raw SQL — no ORM),
  Upstash Redis (`@upstash/redis`), Firebase Storage (`firebase` / `firebase-admin`)
  for snapshot images. State: Zustand. Fetching: SWR.
- **ML inference (serverless):** `onnxruntime-node` + `sharp`, run from cron routes.
- **ML training (Python):** PyTorch → ONNX pipeline in `ml/` (see `ml/OPERATING_GUIDE.md`).
- **Tests:** Vitest (`npm test`) for TS; pytest-style scripts in `ml/`.
- **Pi firmware:** separate repo (`sunset-cam-firmware`), speaks the device protocol.

## Layout
- `app/` — Next.js app. Notable: `app/api/cron/` (scoring + cleanup ticks),
  `app/api/admin/` + `app/components/console/` (the private operator drawer/studio),
  `app/api/cameras|snapshots/` (custom-camera ingest), `app/kiosk/{sunrise,sunset}/`,
  `app/models/[slug]/` (model analysis pages), `app/setup/[claim_code]/` (setup wizard).
- `ml/` — training, eval, ONNX export (`export_onnx_versioned.py`), hard-example mining
  (`report_disagreements.py`), LLM raters (`llm_rater.py`), configs in `ml/configs/`.
- `database/` — schema / SQL.
- `scripts/` — deploy + ops helpers.
- `docs/` — durable docs (see Knowledge store below).

## Knowledge store — read before working in a documented area
- **`docs/solutions/`** — documented learnings (bugs, conventions, design patterns,
  best practices), organized by category with YAML frontmatter (`module`, `tags`,
  `problem_type`, `component`). Relevant when implementing or debugging in a documented
  area. Add to it with `/ce-compound`.
- **`STRATEGY.md`** — product anchor; trace features back to a track here.
- **`docs/compound-engineering.md`** — the CE operating guide (workflow + house rules).
- **`docs/ml-deploy-runbook.md`** — model deploy steps + the hard-won deploy traps.
- **`docs/device-protocol.md`** — custom-camera wire protocol (auth, winner selection, OTA).
- **`ml/OPERATING_GUIDE.md`** — ML training/export workflow.

## Conventions & anchored truths (load-bearing — violating these causes real bugs)
- **Three distinct ratings:** `initial_rating` (seed), `calculated_rating` (user avg,
  denormalized for fast reads), `ai_rating` (ML). Don't conflate them.
- **Server model is authoritative;** on-device `edge_score` only pre-filters.
- **Device auth is two-secret:** claim code bootstraps (single-use), device token
  persists (machine-only); store only the SHA-256 hash, never the token.
- **Binary threshold is normalized:** compare against `[0,1]` labels (≥4-on-5 = `0.75`),
  NOT raw `4.0`. See `docs/ml-deploy-runbook.md`.
- **ML splits are frozen:** deterministic seed + `hash(webcam_id)`; test set is
  evaluation-only; never reshuffle or tune on it.
- **ONNX fallback must be loud:** verify `fallbacks === 0` and real-ONNX latency after
  deploy; a silent baseline fallback ships a dead model. See
  `docs/solutions/best-practices/silent-ml-fallback-observability.md`.
- **Private studio writes are gated server-side**, not by hiding UI. See
  `docs/solutions/conventions/gate-writes-at-api-layer.md`.
- **The mundane feeds are the art** — don't globally filter low-scoring frames; modulate
  by score (kiosk scales tile size), filter-to-best only on opt-in surfaces.

## Working norms
- **Verify the branch before committing.** Jesse merges PRs in parallel, so a subagent's
  assumed branch may be wrong — confirm `git branch --show-current` first.
- **Commit/PR only when asked**; branch off `main` first.
- **Compound engineering is the spine:** `/ce-brainstorm` → `/ce-plan` → `/ce-work` →
  `/ce-code-review` → `/ce-compound`. Document non-trivial work with `/ce-compound`.
- Run `npm test` (Vitest) for TS changes; the relevant `ml/` scripts for ML changes.

## Not part of this product (parallel art/grant work — don't touch when working on the app)
`art-grant-skill/`, `Supporting Text/`, `CV_DOCX_BUILD_NOTES.md`, `LACMA_DOCX_BUILD_NOTES.md`,
`matching_workflow.md`. These are Jesse's separate art/grant artifacts; ignore them for
product work (they're candidates to relocate to their own repo).
