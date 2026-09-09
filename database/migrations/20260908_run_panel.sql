-- Whole-evening run capture: a bounded panel of cameras whose frames are kept
-- regardless of model score.
--
-- Why: the archive's other intake reasons are model-gated. Measured 2026-09-08,
-- inside 6+ frame sunset runs from the last 45 days, 4,864 frames entered as
-- 'disagreement' against 66 as 'trickle'. The N-to-1 crossing is exactly where
-- both heads agree nothing is there, so the boundary that carries 21 of the 35
-- ceiling disagreements is the one intake systematically drops. Crossing labels
-- derived from those gaps would be interpolations across non-random holes.
-- Spec: docs/superpowers/specs/2026-09-08-run-crossing-labeling-design.md
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260908_run_panel.sql --apply

CREATE TABLE IF NOT EXISTS run_panel (
  webcam_id  BIGINT PRIMARY KEY,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

-- 'run' joins the existing reasons. The full list is restated because the
-- constraint is replaced wholesale, not extended.
ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture',
    'operator_label', 'kiosk_bin', 'run'
  ));

-- Seeded OFF. Flip with scripts/set-runtime-flag.mjs once the panel is seeded.
INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'run_panel_capture',
  false,
  'Keep every scored frame for cameras in run_panel, stamped intake_reason=run. ~9 frames per camera-evening.'
)
ON CONFLICT (key) DO NOTHING;
