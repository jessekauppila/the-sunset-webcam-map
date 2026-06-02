-- Hard-example mining + private labeling. See
-- docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md
--
-- Forward-only, idempotent. Apply via:
--   psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql

-- Per-user verdict on whether a snapshot shows a sunrise/sunset. NULL =
-- no opinion. The existing rating column stays unchanged; both can be
-- written in one upsert from the rate endpoint.
ALTER TABLE webcam_snapshot_ratings
  ADD COLUMN IF NOT EXISTS is_sunset_verdict BOOLEAN;

-- Denormalized columns on webcam_snapshots. The rate endpoint recomputes
-- both at submit time from the per-user rows. The cleanup endpoint and
-- the cron read from these for speed.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS human_sunset_majority BOOLEAN;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS model_disagreement_kind TEXT;

-- Partial index — fast queue reads for the Hard Examples tab.
CREATE INDEX IF NOT EXISTS webcam_snapshots_disagreement_idx
  ON webcam_snapshots (captured_at DESC)
  WHERE model_disagreement_kind IS NOT NULL;
