-- Three-judge hard examples — Phase 3 (plan U5). Adds the per-image model-score
-- columns to external_images so the Flickr set carries all three judges, mirroring
-- what 20260604 added to webcam_snapshots. external_images already has the Claude
-- judge (llm_quality, llm_is_sunset, llm_rated_at, …, populated for the v4 export);
-- it has NONE of the model columns, so the full set is added here:
--
--   ai_regression_score / ai_model_version_regression
--     The regression head's [0,1] score + model version (the model judge).
--
--   ai_binary_score / ai_binary_is_sunset / ai_model_version_binary
--     The binary head's verdict (the third judge, R1).
--
--   scoring_path
--     Provenance of the score: 'onnx' | 'cache-hit' | 'unscored' (post-#45; there
--     is no metadata fallback — the model is the only thing that may produce a score).
--
--   scoring_state
--     Sentinel distinct from scoring_path. 'dead-url' marks an image whose URL 404s
--     permanently so the backfill finder excludes it. NULL = scoreable.
--
--   model_disagreement_kind / disagreement_computed_at
--     The model-vs-Claude (and binary-vs-regression) verdict + when it was last
--     (re)computed; the recompute finder compares disagreement_computed_at against
--     llm_rated_at, identical to the webcam_snapshots path.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260607_external_images_model_columns.sql

ALTER TABLE external_images
  ADD COLUMN IF NOT EXISTS ai_regression_score        NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_model_version_regression TEXT,
  ADD COLUMN IF NOT EXISTS ai_binary_score            NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_binary_is_sunset        BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_model_version_binary    TEXT,
  ADD COLUMN IF NOT EXISTS scoring_path               TEXT,
  ADD COLUMN IF NOT EXISTS scoring_state              TEXT,
  ADD COLUMN IF NOT EXISTS model_disagreement_kind    TEXT,
  ADD COLUMN IF NOT EXISTS disagreement_computed_at   TIMESTAMPTZ;

-- Backfill finder hot path: unscored, scoreable Flickr rows ordered by recency.
-- Partial index keeps the one-time drain cheap (mirrors webcam_snapshots_needs_score_idx).
CREATE INDEX IF NOT EXISTS external_images_needs_score_idx
  ON external_images (scraped_at DESC)
  WHERE ai_regression_score IS NULL
    AND image_url IS NOT NULL
    AND scoring_state IS DISTINCT FROM 'dead-url';

-- Recompute finder hot path: rows that already have both a model score and a Claude
-- score, ordered by llm_rated_at DESC (mirrors webcam_snapshots_needs_recompute_idx).
CREATE INDEX IF NOT EXISTS external_images_needs_recompute_idx
  ON external_images (llm_rated_at DESC)
  WHERE ai_regression_score IS NOT NULL
    AND llm_quality IS NOT NULL;
