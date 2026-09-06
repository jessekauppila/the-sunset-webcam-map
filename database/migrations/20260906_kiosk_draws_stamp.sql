-- Solo replay: stamp each draw with what drew it (spec
-- docs/superpowers/specs/2026-09-06-solo-replay-design.md §2), so a draw
-- row explains itself after the bin row is gone and the deploy has moved on.
--
--   version            'solo' | 'solo2', the engine that drew
--   deploy_id          newest kiosk_deploys.id at the draw: the dials in force
--   bin / quality / detection   the entry as the engine saw it
--   shown_snapshot_ids every frame the dwell played (solo2 camera run), the
--                      chosen one included; [snapshot_id] for solo
--
-- Rows from before this migration keep nulls; readers fall back to the
-- kiosk_bin_entries join for bin and scores.
--
-- Forward-only, idempotent. APPLY BEFORE MERGING the code: logDraw writes
-- these columns in one insert and swallows its own error, so a missing
-- column loses the tape silently.
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws_stamp.sql
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws_stamp.sql --apply

ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS version            TEXT;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS deploy_id          INTEGER;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS bin                TEXT;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS quality            REAL;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS detection          REAL;
ALTER TABLE kiosk_draws ADD COLUMN IF NOT EXISTS shown_snapshot_ids BIGINT[];
