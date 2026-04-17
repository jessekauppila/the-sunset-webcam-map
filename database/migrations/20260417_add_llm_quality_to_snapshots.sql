-- Add LLM quality rating columns to webcam_snapshots.
-- These are filled by ml/llm_rater.py when run with --write-to-db.
-- Existing rows default to NULL (unrated by LLM).

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS llm_quality REAL,
  ADD COLUMN IF NOT EXISTS llm_model TEXT,
  ADD COLUMN IF NOT EXISTS llm_rated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_quality_idx
  ON webcam_snapshots (llm_quality)
  WHERE llm_quality IS NOT NULL;
