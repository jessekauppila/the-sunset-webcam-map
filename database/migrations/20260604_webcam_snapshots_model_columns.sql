-- Three-judge hard examples (plan U3/U3b). Adds the per-snapshot columns the
-- archive backfill and the disagreement-recompute pass need but which don't
-- exist yet:
--
--   ai_binary_score / ai_binary_is_sunset / ai_model_version_binary
--     Persist the binary head's verdict per snapshot. The binary columns only
--     existed on `webcams` before; the third judge (R1) needs them on the row
--     so the archive carries all three opinions and binary-vs-regression
--     disagreements are queryable historically.
--
--   scoring_state
--     A sentinel distinct from `scoring_path` (which records onnx/baseline
--     PROVENANCE). 'dead-url' marks a snapshot whose image 404s permanently so
--     the backfill finder excludes it and the 33k drain terminates instead of
--     re-fetching-and-failing the same row every tick. NULL = scoreable.
--
--   disagreement_computed_at
--     When model_disagreement_kind was last (re)computed. The U3b recompute
--     finder compares this against llm_rated_at to catch frames Claude scored
--     AFTER the model backfill ran (the originally-Claude-absent ~3.4k).
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260604_webcam_snapshots_model_columns.sql

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS ai_binary_score          NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS ai_binary_is_sunset      BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_model_version_binary  TEXT,
  ADD COLUMN IF NOT EXISTS scoring_state            TEXT,
  ADD COLUMN IF NOT EXISTS disagreement_computed_at TIMESTAMPTZ;

-- Backfill finder hot path: unscored, scoreable snapshots ordered by recency.
-- Partial index keeps the per-tick top-up cheap as the archive drains.
CREATE INDEX IF NOT EXISTS webcam_snapshots_needs_score_idx
  ON webcam_snapshots (captured_at DESC)
  WHERE ai_regression_score IS NULL
    AND firebase_url IS NOT NULL
    AND scoring_state IS DISTINCT FROM 'dead-url';

-- Recompute finder hot path (findSnapshotsNeedingDisagreementRecompute): the
-- COMPLEMENT of the backfill set — rows that already have both a model score and
-- a Claude score — ordered by llm_rated_at DESC. The backfill index above
-- (ai_regression_score IS NULL) gives this query zero help and empties out as
-- the archive fills, so without this the hourly recompute cron seq-scans the
-- whole (growing) table. Partial index on the candidate set provides both the
-- filter narrowing and the sort order; the disagreement_computed_at < llm_rated_at
-- comparison stays a cheap residual filter over the already-narrowed rows.
CREATE INDEX IF NOT EXISTS webcam_snapshots_needs_recompute_idx
  ON webcam_snapshots (llm_rated_at DESC)
  WHERE ai_regression_score IS NOT NULL
    AND llm_quality IS NOT NULL;
