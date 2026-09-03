-- Failed boxes, counted apart from empty ones.
--
-- boxes_empty conflated "no cameras there" with "the call failed", because
-- fetchWebcamsFor returned [] on any non-OK response. Measured 2026-09-03:
-- 2,250 Windy errors in 24h, all 400, on boxes touching the poles and the
-- antimeridian, every one recorded as ocean. That made the empty share
-- useless as a quota signal at any sample size. This column is the
-- disambiguation. boxes_empty now means 200-with-nothing only.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260903_sweep_failed_boxes.sql --apply

ALTER TABLE daily_sweep_ring_stats
  ADD COLUMN IF NOT EXISTS boxes_failed INTEGER NOT NULL DEFAULT 0;
