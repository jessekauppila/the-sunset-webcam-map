-- Per-camera calibration (tempering prior).
-- Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
--
-- Three things:
--   camera_calibration_evidence  one APPEND-ONLY row per labeled frame per
--                                model version, carrying the scores that made
--                                it count so a tempering decision can be
--                                re-examined later without rescoring through
--                                ONNX. Nothing in this system deletes from it.
--   camera_calibration_history   multiplier CHANGE events, so healing and
--                                drift are observable rather than asserted.
--   webcams.calibration_*        the live value the display reads.
--                                NULL = neutral; new cameras need no backfill.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260901_camera_calibration.sql

CREATE TABLE IF NOT EXISTS camera_calibration_evidence (
  id              BIGSERIAL PRIMARY KEY,
  webcam_id       BIGINT NOT NULL,
  snapshot_id     BIGINT NOT NULL,
  -- Scoping by model version is the fix for the exact defect that killed the
  -- model-vs-Claude wide signal: evidence from a retired head must never
  -- drive a live multiplier.
  model_version   TEXT NOT NULL,
  -- The leg-2 socket. A second writer appends rows; aggregation is unchanged.
  evidence_source TEXT NOT NULL,
  is_negative     BOOLEAN NOT NULL,
  fired           BOOLEAN NOT NULL,
  captured_on     DATE NOT NULL,
  -- Frame record. firebase_url is denormalised ON PURPOSE: this table must
  -- stay reviewable years from now, independent of webcam_snapshots.
  p_sunset        NUMERIC(6,4) NOT NULL,
  quality         NUMERIC(6,4),
  tile            NUMERIC(6,4),
  firebase_url    TEXT NOT NULL,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, model_version, evidence_source)
);

-- Hot path: the nightly aggregation scans one model generation per camera.
CREATE INDEX IF NOT EXISTS camera_calibration_evidence_cam_idx
  ON camera_calibration_evidence (webcam_id, model_version, captured_on DESC);

CREATE TABLE IF NOT EXISTS camera_calibration_history (
  id                  BIGSERIAL PRIMARY KEY,
  webcam_id           BIGINT NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  multiplier          NUMERIC(4,3) NOT NULL,
  previous_multiplier NUMERIC(4,3),
  false_shows         NUMERIC(8,3) NOT NULL,
  negative_frames     NUMERIC(8,3) NOT NULL,
  raw_false_shows     INT NOT NULL,
  false_show_days     INT NOT NULL,
  model_version       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS camera_calibration_history_cam_idx
  ON camera_calibration_history (webcam_id, computed_at DESC);

ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS calibration_multiplier  NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS calibration_evidence    JSONB,
  ADD COLUMN IF NOT EXISTS calibration_computed_at TIMESTAMPTZ;
