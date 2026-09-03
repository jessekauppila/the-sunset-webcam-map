-- daily_sweep_geometry: the ring angles behind each day's sweep counters.
--
-- daily_sweep_ring_stats keys on offset_deg, which is meaningless on its own:
-- +15.75 is +2.75 degrees of solar altitude only while the base ring sits at
-- -13. The pool-coverage work expects the base altitude, the radius and the
-- offset set to move more than once, so every historical row needs the
-- geometry that produced it stored beside it rather than inferred from
-- whatever masterConfig.ts happens to say later.
--
-- One row per (date, signature). A configuration change mid-day writes a
-- SECOND row for that date rather than overwriting the first, so the
-- transition is visible instead of averaged away -- which is exactly the
-- moment the record exists for.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_sweep_geometry.sql --apply

CREATE TABLE IF NOT EXISTS daily_sweep_geometry (
  date               DATE NOT NULL,        -- UTC date, matches daily_sunset_stats
  -- Stable label for one configuration, e.g.
  -- 'base-13_r11_off15.75,-15.75_forced15.75'. Comparing signatures across
  -- days is how a change is spotted without diffing six columns.
  signature          TEXT NOT NULL,
  base_altitude_deg  NUMERIC(6,2) NOT NULL,
  search_radius_deg  NUMERIC(6,2) NOT NULL,
  widen_offsets_deg  TEXT NOT NULL,        -- every offset the sweep MAY run
  forced_offsets_deg TEXT NOT NULL,        -- offsets it ran unconditionally
  -- The resulting solar-altitude span, stored rather than derived so it
  -- survives a change to the derivation itself.
  coverage_min_deg   NUMERIC(6,2) NOT NULL,
  coverage_max_deg   NUMERIC(6,2) NOT NULL,
  ticks              INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, signature)
);
