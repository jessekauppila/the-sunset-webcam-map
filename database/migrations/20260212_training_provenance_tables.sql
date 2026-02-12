-- Training provenance tables for reproducible model runs.

CREATE TABLE IF NOT EXISTS model_training_runs (
  id BIGSERIAL PRIMARY KEY,
  model_version TEXT NOT NULL UNIQUE,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS model_training_snapshot_labels (
  id BIGSERIAL PRIMARY KEY,
  training_run_id BIGINT NOT NULL REFERENCES model_training_runs(id) ON DELETE CASCADE,
  snapshot_id INTEGER NOT NULL REFERENCES webcam_snapshots(id) ON DELETE CASCADE,
  label_source TEXT NOT NULL,
  label_value DECIMAL(3,2) NOT NULL,
  included_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT model_training_snapshot_labels_unique_run_snapshot
    UNIQUE (training_run_id, snapshot_id)
);

CREATE INDEX IF NOT EXISTS model_training_snapshot_labels_run_idx
  ON model_training_snapshot_labels (training_run_id);

CREATE INDEX IF NOT EXISTS model_training_snapshot_labels_snapshot_idx
  ON model_training_snapshot_labels (snapshot_id);
