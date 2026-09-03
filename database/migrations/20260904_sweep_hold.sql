-- Pool retention: count the ticks that kept the last good pool because the
-- sweep could not see the world (no boxes, nothing found, or at least half
-- the boxes non-OK). Tick-level like the other sweep_* counters: one tick
-- contributes at most 1, so the column reads "N of today's ticks held".
--
-- Forward-only, idempotent. Apply manually via:
--   node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql
--   node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql --apply

ALTER TABLE daily_sunset_stats
  ADD COLUMN IF NOT EXISTS sweep_held_ticks INTEGER NOT NULL DEFAULT 0;
