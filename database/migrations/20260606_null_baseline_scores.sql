-- Null the AI-produced scores that the metadata heuristic fabricated, so the
-- leaderboard stops ranking guesses and the ONNX backfill reclaims these rows
-- (finder = WHERE ai_regression_score IS NULL). Forward-only, idempotent.
--
-- SCOPE BOUNDARY: touches ONLY ai_* / scoring_path / model_disagreement_kind.
-- It NEVER touches human-rating columns — webcams.rating, initial_rating, or
-- any column of webcam_snapshot_ratings — which are preserved for v5 training.
--
-- Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260606_null_baseline_scores.sql

-- 1) Snapshots: the source of truth the leaderboard ranks.
UPDATE webcam_snapshots
SET ai_regression_score     = NULL,
    ai_rating               = NULL,
    scoring_path            = NULL,
    model_disagreement_kind = NULL
WHERE scoring_path IN ('baseline', 'baseline-fallback');

-- 2) Denormalized AI values on webcams (written by the live-cron baseline path).
--    webcams has no per-row scoring_path, so null all denormalized AI ratings
--    and let the next real ONNX score re-sync each webcam. webcams.rating
--    (human) is intentionally NOT in this list.
UPDATE webcams
SET ai_rating            = NULL,
    ai_rating_regression = NULL,
    ai_rating_binary     = NULL;
