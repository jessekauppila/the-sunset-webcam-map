-- Phase 1 of the model-mosaic integration. Two unrelated additions in one
-- migration because they're both pre-requisites for the new cron tick:
--   1. daily_sunset_stats: observability/leaderboard rollups, UPSERTed every tick
--   2. webcam_snapshots.ai_regression_score + ai_model_version_regression:
--      written by the cron's custom-camera backfill (Phase 1) and read by
--      Phase 2 winner selection. The supporting partial index ships in
--      Phase 2 once we have row volume.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260515_model_mosaic_phase1.sql

CREATE TABLE IF NOT EXISTS daily_sunset_stats (
  date                            DATE PRIMARY KEY,           -- UTC date
  model_version                   TEXT NOT NULL,
  webcams_scored                  INTEGER NOT NULL DEFAULT 0,
  cache_hits                      INTEGER NOT NULL DEFAULT 0,
  fallbacks                       INTEGER NOT NULL DEFAULT 0,
  score_avg                       NUMERIC(4,3),
  score_p50                       NUMERIC(4,3),
  score_p90                       NUMERIC(4,3),
  score_p99                       NUMERIC(4,3),
  above_min_score_to_win_count    INTEGER NOT NULL DEFAULT 0,
  source_breakdown                JSONB,
  -- Phase 2 winner-tracking columns; nullable in Phase 1
  winners_picked                  INTEGER,
  winners_kept                    INTEGER,
  winners_pruned                  INTEGER,
  top_winner_score                NUMERIC(4,3),
  finalized_at                    TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS ai_regression_score         NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_model_version_regression TEXT;
