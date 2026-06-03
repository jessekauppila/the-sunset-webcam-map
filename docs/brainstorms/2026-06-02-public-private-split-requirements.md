---
date: 2026-06-02
topic: public-private-split
---

# Public / Private Split of the Sunrise/Sunset Hub

## Summary

Split the website into a public, read-only hub and a login-gated private studio by
gating the existing single drawer rather than building a separate admin app. The public
gets the live map, a new best-sunset leaderboard, and read-only Curated / Archive /
Model-Analysis views; a single allow-listed Google login unlocks editing (rating,
verdicts, orientation), the Unrated Queue, and live review. Public rating goes read-only
now, with the schema kept ready to re-enable crowd rating later.

## Problem Frame

The whole site is public and unauthenticated today, and the drawer (`app/HomeClient.tsx`)
already mixes public-worthy views with operator tooling in one surface. Four data-mutating
routes — `POST`/`DELETE /api/snapshots/[id]/rate`, `POST /api/snapshots/capture-and-rate`,
`PATCH /api/webcams/[id]/rating`, `PATCH /api/webcams/[id]/orientation` — accept writes
from anyone with no session check; the only "identity" is a spoofable anonymous UUID in
`localStorage`. That means the rating data that trains and tunes the model is open to
anyone, which is a direct risk to the label pipeline.

At the same time the product wants two different things from one site: a public face that
conveys the project by *showing* it (map + leaderboards) and a private place for Jesse to
rate frames, manage the archive, and sanity-check models against live skies. This split
resolves both — and resolves a contradiction the strategy surfaced (the README treats
`calculated_rating` as a crowd average, while the strategy now says "no public rating at
scale, single login for now").

## Key Decisions

- **One drawer that expands on login, not a separate `/studio` app.** The unified drawer
  already exists; gate capabilities within it rather than fork the application. Logged-out
  renders read-only; logged-in reveals controls and private tabs.
- **Single allow-listed Google login (Auth.js), enforced at the API layer.** Hiding UI is
  cosmetic; every mutating route verifies the session server-side. See
  `docs/solutions/conventions/gate-writes-at-api-layer.md`.
- **Defer public crowd rating; keep the schema ready.** Public rating goes read-only now,
  but `webcam_snapshot_ratings` and the `user_session_id` concept are retained so crowd
  rating can switch on later without rework.
- **Leaderboard ranks by the human ratings we've applied (`calculated_rating`), not the
  model score.** The "best sunsets" board reflects real human judgment; `ai_rating` is the
  model's guess and stays out of the ranking.
- **Retain high-rated frames so the best-of persists.** Snapshots rated above a threshold
  are kept beyond the normal cleanup window — otherwise the all-time leaderboard has nothing
  to show once frames age out.
- **The "dummy-check" is a private review use of existing data, not new inference.** Jesse
  reviews live sunrises/sunsets alongside the cron's already-computed scores to confirm the
  pipeline is updating and rating correctly. On-demand / multi-model live inference is a
  separate future capability (see Scope Boundaries).

## Actors

- A1. **Public visitor** — unauthenticated. Reads the map, the leaderboard, and the
  read-only drawer views. Cannot write anything.
- A2. **Studio operator (Jesse)** — the single allow-listed account. Rates and labels
  frames, edits webcam rating/orientation, reviews live skies to verify the pipeline, and
  triggers cleanup.

## Requirements

**Authentication & write-gating**

- R1. Only a pre-approved allow-listed Google account authenticates as the operator; every
  other visitor is treated as public/anonymous.
- R2. Every data-mutating API route verifies the authenticated operator session
  server-side before writing and rejects unauthenticated or unauthorized requests. This
  explicitly includes the four currently-open routes named in the Problem Frame. Cron and
  capture paths continue to use the existing `CRON_SECRET` mechanism.
- R3. All read endpoints powering the public surface remain accessible without
  authentication.
- R4. The hub provides a clear sign-in / sign-out affordance; signed-in state visibly
  unlocks studio capabilities.

**Public surface (read-only)**

- R5. The public lands on the live map with no login required — the primary
  show-don't-tell surface.
- R6. The drawer is visible to the public in read-only form: Current Sunrises/Sunsets
  (view only), Snapshot Archive (browse), Curated (browse), and Model Analysis (the "how
  the AI learns" storytelling). No edit controls and no Unrated Queue are present or active
  for the public.
- R7. The best-sunset leaderboard (R13–R15) is part of the public surface.

**Private studio (authenticated)**

- R8. When signed in, the same drawer exposes edit controls inline: snapshot rating,
  webcam rating, and webcam orientation.
- R9. The Unrated Queue (rapid labeling) is available only when signed in.
- R10. Any verdict / hard-example labeling UI (e.g. `is_sunset_verdict`) is available only
  when signed in. (Presence of this UI in the drawer is unverified — see Dependencies.)
- R11. Signed-in review ("dummy-check"): the operator can view sunrises/sunsets happening
  now alongside their current cron-computed `ai_rating` to confirm the pipeline is updating
  and frames are rated correctly. This reuses the existing live view and stored scores; it
  introduces no on-demand inference.
- R12. Destructive actions (cleanup) stay gated and are never exposed to the public UI.

**Best-sunset leaderboard**

- R13. The public leaderboard ranks sunrises/sunsets by the human-applied ratings we've
  used (`calculated_rating`), not by `ai_rating`.
- R14. The leaderboard supports multiple groupings and time windows — overall, per-webcam,
  and per-country, across "now", "today", and "all-time".
- R15. The primary surface is a public drawer tab; shareable deep-link routes (in the style
  of `app/models/[slug]`) are a near-term extension, not part of the first cut.

**Ratings & data posture**

- R16. Anonymous public rating writes are disabled; the rating write path is gated to the
  operator.
- R17. The ratings schema (`webcam_snapshot_ratings`, `user_session_id`) is retained so
  crowd rating can be re-enabled later without redesign.
- R18. `calculated_rating` (the average of human star ratings) is the leaderboard signal.
  With public rating disabled it is fed by operator ratings going forward; existing
  anonymous ratings are retained as historical contributions to it.
- R19. Snapshots whose rating exceeds a configurable threshold are retained beyond the
  standard cleanup window, so the best-sunset archive and the all-time leaderboard persist.
  (Verify against current cleanup behavior — see Dependencies.)

## Key Flows

- F1. Public visit
  - **Trigger:** An anonymous visitor opens the site.
  - **Actors:** A1
  - **Steps:** Map loads → visitor opens the drawer → sees read-only Current /
    Archive / Curated / Model-Analysis and the Best-Sunsets leaderboard → no edit controls
    anywhere.
  - **Covered by:** R3, R5, R6, R7, R13
- F2. Operator signs in
  - **Trigger:** Jesse uses the sign-in affordance with the allow-listed account.
  - **Actors:** A2
  - **Steps:** Authenticates via Google → session established → drawer now shows edit
    controls, the Unrated Queue, and verdict labeling → can review live skies against
    scores.
  - **Covered by:** R1, R4, R8, R9, R10, R11
- F3. Unauthorized write attempt
  - **Trigger:** Any request (UI or direct) tries to mutate data without a valid operator
    session.
  - **Actors:** A1
  - **Steps:** Request hits a mutating route → server checks session → rejects with no
    write performed.
  - **Covered by:** R2, R16

## Acceptance Examples

- AE1. **Covers R2, R16.** **Given** no operator session, **when** a `POST` is sent
  directly to the snapshot-rating route, **then** it is rejected and no row is written.
- AE2. **Covers R6, R8.** **Given** a logged-out drawer, **then** no rating/orientation
  controls render; **and given** the operator is logged in, **then** the same drawer shows
  those controls and writes succeed.
- AE3. **Covers R9.** **Given** a logged-out visitor, **then** the Unrated Queue is not
  accessible.
- AE4. **Covers R13.** **Given** a set of rated snapshots, **then** leaderboard ordering
  reflects `calculated_rating` (the human ratings), not `ai_rating`.
- AE5. **Covers R14, R19.** **Given** a snapshot rated above the retention threshold,
  **then** it survives the standard cleanup window and remains available to the all-time
  leaderboard.

## Scope Boundaries

**Deferred for later**

- On-demand / multi-model live inference — running one or more (including candidate,
  not-yet-deployed) models against current frames inside a request to compare them live.
  This is its own capability with real compute, latency, bundling, and silent-fallback
  concerns, and belongs to the ML-quality track with a dedicated brainstorm.
- Public accounts and crowd rating at scale — schema is kept ready, but enabling it is out
  of this cut.
- Shareable leaderboard deep-link routes — a fast-follow after the leaderboard tab ships.

**Outside this product's identity (for now)**

- Multi-user roles and permissions beyond a single operator account.

## Dependencies / Assumptions

- No auth library is installed today; this introduces Auth.js (NextAuth) with a Google
  provider and an allow-list of permitted account(s). No `middleware.ts` exists yet.
- The unified drawer (`app/HomeClient.tsx`) and its existing tabs/read APIs are the surface
  being gated.
- `ai_rating` is populated by the cron for live frames and is suitable as the leaderboard
  signal — assumption to confirm.
- Per-webcam country/location data is available (or derivable) for the per-country
  leaderboard grouping — to verify.
- A verdict / hard-example labeling UI may or may not exist in the drawer yet (recon found
  ML-side `ml/report_disagreements.py` but no dedicated drawer tab) — confirm during
  planning what, if anything, needs gating for R10.
- The all-time leaderboard (R14) depends on retaining high-rated snapshots beyond the
  standard ~7-day cleanup (`app/api/snapshots/cleanup`). Current retention keeps rated /
  disagreement / future-winner rows — verify whether that already covers high-rated frames
  and extend it with the rating-threshold rule (R19) if not.

## Outstanding Questions

**Resolve before planning**

- The retention rule for R19: the threshold value and whether it keys off the human
  `calculated_rating`, `ai_rating`, or either — it shapes the cleanup change and what the
  all-time leaderboard can show.

**Deferred to planning**

- The exact per-route session-check mechanism and where the sign-in UI lives.
- Whether to leave legacy anonymous ratings untouched or archive them.
- The source for per-webcam country derivation.
