-- Operator gold-label set for v5 training (plan: hard-examples labeling queue).
-- One row per (source, image_id) — the operator's adjudication of a hard /
-- disagreement frame. Distinct from webcam_snapshot_ratings (public crowd
-- ratings); that idea is retired. Forward-only, idempotent.
--   psql "$DATABASE_URL" -f database/migrations/20260608_manual_labels.sql

CREATE TABLE IF NOT EXISTS manual_labels (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id    BIGINT NOT NULL,
  is_sunset   BOOLEAN NOT NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  origin      TEXT NOT NULL DEFAULT 'hard_example',
  labeled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, image_id)
);

-- Carry over existing operator verdicts from the old blind Hard Examples queue.
INSERT INTO manual_labels (source, image_id, is_sunset, rating, origin, labeled_at)
SELECT 'webcam', snapshot_id, is_sunset_verdict, rating, 'hard_example', created_at
FROM webcam_snapshot_ratings
WHERE is_sunset_verdict IS NOT NULL
ON CONFLICT (source, image_id) DO NOTHING;
