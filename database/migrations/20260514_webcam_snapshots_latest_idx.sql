-- Non-partial composite index supporting "latest snapshot per webcam_id"
-- queries used by the terminator payload's LEFT JOIN LATERAL. The existing
-- webcam_snapshots_winners_idx is partial (is_window_winner = TRUE only) and
-- does not serve queries that read the latest capture regardless of winner
-- status, which is what the custom-camera popup needs.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260514_webcam_snapshots_latest_idx.sql

CREATE INDEX IF NOT EXISTS webcam_snapshots_latest_idx
  ON webcam_snapshots (webcam_id, captured_at DESC);
