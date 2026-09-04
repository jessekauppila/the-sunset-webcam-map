-- Frames captured because an operator rated a live tile.
--
-- The map popup and the /studio preview can now write a gold label for what
-- is on screen. A live Windy tile is not in the archive — its preview is a
-- CDN address whose content rotates behind a fixed URL — so the label cannot
-- be written until the frame is captured. Those rows arrive for exactly one
-- reason and need their own label, the same argument 'scene_capture' and
-- 'trickle' make: an intake arm that cannot be told apart after the fact is
-- unrecoverable, and this one is an ungated draw from whatever was on the
-- wall, which is precisely the population an ML export wants to separate.
--
-- Apply with:
--   node scripts/apply-migration.mjs database/migrations/20260903_operator_label_intake.sql --apply

ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture',
    'operator_label'
  ));
