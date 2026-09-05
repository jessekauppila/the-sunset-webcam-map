-- Solo kiosk: the zone the cron last aged bin entries against.
--
-- One row. Written by binAdmission.maintainBins every tick with the band
-- every ring that swept THIS tick gathered from (escalations included); read
-- by GET /api/kiosk/solo/state and POST /api/kiosk/solo/advance so the studio
-- shows the band the bins were really checked against, not a guess from the
-- day-ring flag. Before this the routes recomputed the guaranteed-rings zone
-- and the cron aged against the same narrower band, which evicted every
-- golden-hour sunrise camera the escalation ring admitted (2026-09-05).
--
-- Forward-only, idempotent. Both readers and the writer degrade to the
-- guaranteed-rings zone when this table is missing, so apply order is not
-- load-bearing, but apply it so the studio strip is honest. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_sweep_zone.sql
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_sweep_zone.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_sweep_zone (
  id          SMALLINT PRIMARY KEY CHECK (id = 1),
  min_deg     NUMERIC(6,2) NOT NULL,
  max_deg     NUMERIC(6,2) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
