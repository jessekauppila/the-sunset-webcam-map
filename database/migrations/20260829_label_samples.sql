-- Fixed, pre-drawn frame samples for the labeling queue.
--
-- Why a table: the Hard Examples queue pulls live from the disagreement set,
-- and every filter it uses is self-erasing — a labeled frame drops out of the
-- pool. A random sample re-derived per request would therefore drift as you
-- rate it, and afterwards nothing would distinguish its labels from the 8k
-- hard-case labels in manual_labels. Membership has to be written down once,
-- before any rating happens.
--
-- `position` freezes the order so a sample is resumable across sittings and
-- progress (n of 200) is exact.
--   psql "$DATABASE_URL" -f database/migrations/20260829_label_samples.sql

CREATE TABLE IF NOT EXISTS label_samples (
  id           BIGSERIAL PRIMARY KEY,
  sample_name  TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id     BIGINT NOT NULL,
  position     INT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sample_name, source, image_id)
);

CREATE INDEX IF NOT EXISTS label_samples_name_pos_idx
  ON label_samples (sample_name, position);
