-- Provider usage snapshots + cost change log for the owner-only Ops tab.
-- Neon's daily consumption-history API is Scale-plan gated, so we snapshot the
-- month-to-date counters from GET /projects/{id} once per UTC day and derive
-- daily deltas at read time.
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260731_provider_usage_and_cost_events.sql

CREATE TABLE IF NOT EXISTS provider_usage_daily (
  day             DATE        NOT NULL,
  project_id      TEXT        NOT NULL,
  compute_time_s  BIGINT      NOT NULL DEFAULT 0,
  active_time_s   BIGINT      NOT NULL DEFAULT 0,
  data_transfer_b BIGINT      NOT NULL DEFAULT 0,
  storage_b       BIGINT      NOT NULL DEFAULT 0,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, project_id)
);

CREATE TABLE IF NOT EXISTS cost_events (
  id          SERIAL PRIMARY KEY,
  occurred_on DATE NOT NULL,
  sha         TEXT,
  description TEXT NOT NULL
);

-- Seed known cost-relevant changes (idempotent via the WHERE NOT EXISTS guard).
INSERT INTO cost_events (occurred_on, sha, description)
SELECT d::date, s, t FROM (VALUES
  ('2026-06-04', NULL,
   'cron */1 -> */15; image-hash dedup moved from Upstash to Neon column'),
  ('2026-07-31', NULL,
   'webcam endpoint autoscale 0.25-1 CU; nwac 0.25 CU + clustered crons; stale 9 CU branch deleted')
) AS seed(d, s, t)
WHERE NOT EXISTS (
  SELECT 1 FROM cost_events e WHERE e.occurred_on = seed.d::date AND e.description = seed.t
);
