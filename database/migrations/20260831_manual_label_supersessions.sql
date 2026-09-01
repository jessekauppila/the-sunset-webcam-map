-- Audit trail for gold labels that a later pass overturned.
--
-- `manual_labels` is UNIQUE(source, image_id) with an ON CONFLICT DO UPDATE
-- write path, so correcting a label necessarily destroys the old one. That is
-- the RIGHT behaviour for a correction — a correction is not a measurement,
-- it IS the new gold — but it must not be silent. Every overwrite applied by
-- ml/apply_label_corrections.py archives the prior row here first, in the same
-- transaction, so the original rating is always recoverable and every
-- correction campaign is auditable after the fact.
--
-- This is deliberately NOT manual_label_retests. That table exists to keep
-- MEASUREMENTS away from gold (a retest must never overwrite). This one
-- records the cases where we decided the first pass was wrong and did
-- overwrite, on purpose.
--   psql "$DATABASE_URL" -f database/migrations/20260831_manual_label_supersessions.sql

CREATE TABLE IF NOT EXISTS manual_label_supersessions (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id        BIGINT NOT NULL,
  old_is_sunset   BOOLEAN NOT NULL,
  old_rating      INT,
  old_origin      TEXT NOT NULL,
  old_labeled_at  TIMESTAMPTZ NOT NULL,
  new_is_sunset   BOOLEAN NOT NULL,
  new_rating      INT,
  -- Which campaign overwrote it, e.g. 'correction_retest_v1'. Matches the
  -- origin stamped onto the surviving manual_labels row.
  new_origin      TEXT NOT NULL,
  -- Free-text justification, so a future reader does not have to reconstruct
  -- why 24 rows changed on one day.
  reason          TEXT,
  superseded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No UNIQUE constraint: a frame corrected twice should leave two archive rows,
-- in order. Lookups are always "what happened to this frame".
CREATE INDEX IF NOT EXISTS manual_label_supersessions_frame_idx
  ON manual_label_supersessions (source, image_id, superseded_at DESC);
