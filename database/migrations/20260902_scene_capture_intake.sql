-- Scene captures enter the archive as a first-class intake reason.
--
-- Every other reason a frame is archived is model-gated (the heads disagree,
-- or the incumbent scored it highly) plus a 2% random trickle. An operator
-- hitting save in /studio archives the ENTIRE ungated terminator pool, which
-- is the strongest unbiased sample the archive gets — the same job the
-- trickle arm exists to do, at much higher volume. It needs its own label or
-- the arm is unrecoverable after the fact, exactly as SAVE_RANDOM_TRICKLE_RATE
-- argues for 'trickle'.
--
-- Apply with:
--   psql "$DATABASE_URL" -f database/migrations/20260902_scene_capture_intake.sql

ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture'
  ));

-- Scenes point at a time window rather than carrying a copy of their frames,
-- so a scene-captured row disappearing takes the scene's ordinary frames with
-- it. Those low-scoring frames carry none of the signals cleanup preserves
-- (no disagreement, no Claude score, no high model score, no human rating) —
-- they would be first in line. `state` is now nullable: a scene resolves from
-- the archive unless it is one of the legacy rows that froze its own pool.
ALTER TABLE kiosk_scenes
  ALTER COLUMN state DROP NOT NULL;

ALTER TABLE kiosk_scenes
  ADD COLUMN IF NOT EXISTS window_minutes INTEGER;
