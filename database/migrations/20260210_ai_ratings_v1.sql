-- AI Ratings V1 minimal schema migration.
-- Purpose:
-- 1) Store the latest AI score on webcams for map popup display.
-- 2) Store model inference history per snapshot for observability and auditing.

ALTER TABLE webcams
ADD COLUMN IF NOT EXISTS ai_rating DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS ai_model_version TEXT;

CREATE TABLE IF NOT EXISTS snapshot_ai_inferences (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES webcam_snapshots(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  raw_score DOUBLE PRECISION NOT NULL,
  ai_rating DECIMAL(3,2) NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT snapshot_ai_inferences_unique_snapshot_model
    UNIQUE (snapshot_id, model_version)
);

CREATE INDEX IF NOT EXISTS snapshot_ai_inferences_snapshot_id_idx
  ON snapshot_ai_inferences (snapshot_id);

CREATE INDEX IF NOT EXISTS snapshot_ai_inferences_model_scored_at_idx
  ON snapshot_ai_inferences (model_version, scored_at DESC);
