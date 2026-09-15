-- solo2 rendezvous: one number between the screens, and the record of it.
-- (beat-and-rendezvous spec docs/superpowers/specs/2026-09-14-solo2-beat-and-rendezvous-design.md §3.3, §6)
--
-- peak_at on kiosk_screen_state is the tick the current dwell's peak lands on,
-- when that draw cleared the rendezvous gate; null otherwise. The advance that
-- starts a dwell writes it, decided once against the pool the draw saw. The
-- other screen reads it on its own advance and fits to it. The screens never
-- talk; this column is the whole conversation.
--
-- rendezvous on kiosk_screen_state says the current dwell's peak was fitted to
-- (or pinned and met by) the other screen's, so the state view can say so
-- without reading the other row (an amendment to spec §3.3).
--
-- The same two on kiosk_draws, so the replay can count what happened.
--
-- Forward-only, idempotent. APPLY BEFORE MERGING the code that writes them:
-- commitAdvance writes these in the same statement as dwell_ms, and a missing
-- column would fail the advance and stall the glass.
--   node scripts/apply-migration.mjs database/migrations/20260915_kiosk_rendezvous.sql
--   node scripts/apply-migration.mjs database/migrations/20260915_kiosk_rendezvous.sql --apply

ALTER TABLE kiosk_screen_state ADD COLUMN IF NOT EXISTS peak_at    TIMESTAMPTZ;
ALTER TABLE kiosk_screen_state ADD COLUMN IF NOT EXISTS rendezvous BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE kiosk_draws        ADD COLUMN IF NOT EXISTS peak_at    TIMESTAMPTZ;
ALTER TABLE kiosk_draws        ADD COLUMN IF NOT EXISTS rendezvous BOOLEAN NOT NULL DEFAULT false;
