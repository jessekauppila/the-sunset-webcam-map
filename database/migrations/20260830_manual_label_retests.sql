-- Retest labels: the operator re-rating frames they already rated, to measure
-- test–retest reliability (the ceiling for any model — see
-- docs/superpowers/plans/2026-08-30-quality-ceiling-and-labeling-roadmap.md).
--
-- A separate table, NOT rows in manual_labels: that table is
-- UNIQUE (source, image_id) and its write path is ON CONFLICT DO UPDATE, so a
-- retest through it would OVERWRITE the gold label. Physical separation also
-- keeps retests out of every training export by construction —
-- export_dataset.py reads manual_labels.
--   psql "$DATABASE_URL" -f database/migrations/20260830_manual_label_retests.sql

CREATE TABLE IF NOT EXISTS manual_label_retests (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id    BIGINT NOT NULL,
  is_sunset   BOOLEAN NOT NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  origin      TEXT NOT NULL,          -- retest sample name, e.g. 'retest_v1'
  labeled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, image_id, origin)   -- one re-rating per frame per campaign
);

-- 'draw' = a normal eval draw (quarantined from training);
-- 'retest' = already-labeled frames served back blind. Their ORIGINAL labels
-- must stay IN training, so export_dataset.py's quarantine guards are scoped
-- to kind = 'draw' — that scoping must land before any retest sample loads.
ALTER TABLE label_samples
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'draw'
  CHECK (kind IN ('draw', 'retest'));
