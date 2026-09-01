-- Why a webcam_snapshots row entered the archive.
--
-- The intake is model-gated: a Windy frame is persisted only when the two
-- heads disagree, or when the incumbent model scores it highly. That is a
-- feedback loop — the archive drifts toward what the incumbent already
-- understands (roadmap 2026-08-30, "Same-camera-pool skew", side item 1).
-- SAVE_RANDOM_TRICKLE_RATE adds an unbiased control arm: a small fraction of
-- frames saved regardless of score.
--
-- The control arm is only usable if it is SEPARABLE afterwards. Without this
-- column a trickle row is indistinguishable from a high-rated one and the
-- unbiased sample cannot be recovered, which is the whole point of taking it.
--
-- NULL = pre-existing rows and every other write path (backfills, custom cams,
-- tier0 uploads). Do not backfill it: a guessed reason would defeat the
-- separation this column exists to provide.
--   psql "$DATABASE_URL" -f database/migrations/20260831_snapshot_intake_reason.sql

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS intake_reason TEXT
  CHECK (intake_reason IN ('disagreement', 'high_rated', 'trickle', 'all_rated'));

-- The trickle arm is a small, uniformly-sampled minority; every analysis of it
-- filters on exactly this value.
CREATE INDEX IF NOT EXISTS webcam_snapshots_intake_reason_idx
  ON webcam_snapshots (intake_reason)
  WHERE intake_reason IS NOT NULL;
