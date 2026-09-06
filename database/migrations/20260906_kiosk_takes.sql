-- kiosk_takes: lets a kiosk_deploys row be a saved take that was never
-- deployed (spec: docs/superpowers/specs/2026-09-05-one-studio-design.md §4).
-- `deployed_at` stops meaning "when this row was created" and starts meaning
-- "when this row was pushed to the glass, if ever" — a take saved via
-- saveTake() leaves it NULL. `created_at` is the new source of truth for
-- row ordering and display time, backfilled from the existing deployed_at
-- so history keeps its original timestamps.
-- Loading a row back still sanitizes each namespace through its current
-- schema (see 20260905_kiosk_deploys.sql); this migration touches only the
-- two timestamp columns.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_takes.sql
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_takes.sql --apply

ALTER TABLE kiosk_deploys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE kiosk_deploys SET created_at = deployed_at WHERE created_at > deployed_at;

ALTER TABLE kiosk_deploys ALTER COLUMN deployed_at DROP NOT NULL;
