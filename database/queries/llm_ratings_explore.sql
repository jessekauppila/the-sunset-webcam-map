-- LLM ratings exploration playbook.
--
-- Run individual blocks in psql or your SQL client. Each query is
-- prefixed with a `--` description so you can grep for the one you want
-- (e.g. `-- 6. Live progress`).
--
-- All queries assume migrations through 20260507 have been applied so
-- that webcam_snapshots has the full LLM column set + JSONB metadata.

-- =====================================================================
-- 1. High-level counts. The first query you run after each new batch.
-- =====================================================================
SELECT
  COUNT(*)                                              AS total_snapshots,
  COUNT(*) FILTER (WHERE firebase_url IS NOT NULL)      AS rateable,
  COUNT(*) FILTER (WHERE llm_quality IS NOT NULL)       AS rated,
  COUNT(*) FILTER (WHERE llm_is_sunset)                 AS sunsets,
  COUNT(*) FILTER (WHERE llm_is_sunrise)                AS sunrises,
  COUNT(*) FILTER (WHERE llm_quality >= 0.7)            AS great_sunsets,
  COUNT(*) FILTER (WHERE llm_quality >= 0.85)           AS spectacular,
  COUNT(*) FILTER (WHERE llm_obstruction IS NOT NULL)   AS obstructed,
  COUNT(*) FILTER (WHERE llm_has_clouds)                AS cloudy,
  COUNT(DISTINCT llm_model)                             AS models_used
FROM webcam_snapshots;

-- =====================================================================
-- 2. Quality histogram (10 buckets across 0.0-1.0).
--    Visual sanity check: are the LLM scores spread across the range
--    or piling up near 0 / 0.5? Piling up = label noise.
-- =====================================================================
SELECT
  WIDTH_BUCKET(llm_quality, 0, 1, 10)            AS bucket,
  COUNT(*)                                       AS n,
  ROUND(100.0 * COUNT(*)
        / SUM(COUNT(*)) OVER (), 1)              AS pct,
  REPEAT('▇', GREATEST(1, COUNT(*)::int / 50))   AS bar
FROM webcam_snapshots
WHERE llm_quality IS NOT NULL
GROUP BY bucket
ORDER BY bucket;

-- =====================================================================
-- 3. Top 20 best-rated sunsets (the "gallery" query).
--    Uses webcam_snapshots_great_sunsets_idx — should be very fast.
-- =====================================================================
SELECT
  s.id,
  s.webcam_id,
  ROUND(s.llm_quality::numeric, 3)        AS quality,
  ROUND(s.llm_confidence::numeric, 2)     AS confidence,
  s.llm_is_sunrise,
  s.llm_time_of_day,
  s.llm_color_palette,
  s.llm_rating_explanation,
  s.firebase_url
FROM webcam_snapshots s
WHERE s.llm_is_sunset = true
  AND s.llm_quality IS NOT NULL
ORDER BY s.llm_quality DESC, s.llm_confidence DESC
LIMIT 20;

-- =====================================================================
-- 4. Top 20 worst-rated images (gut check on what scored 0.0).
--    Useful to confirm the LLM correctly hates dark / obstructed frames.
-- =====================================================================
SELECT
  s.id,
  s.webcam_id,
  ROUND(s.llm_quality::numeric, 3)        AS quality,
  ROUND(s.llm_confidence::numeric, 2)     AS confidence,
  s.llm_obstruction,
  s.llm_time_of_day,
  s.llm_rating_explanation,
  s.firebase_url
FROM webcam_snapshots s
WHERE s.llm_quality IS NOT NULL
ORDER BY s.llm_quality ASC, s.llm_confidence DESC
LIMIT 20;

-- =====================================================================
-- 5. Where do humans and the LLM most disagree? (review queue)
--    Rows with >=2 human ratings AND a big gap from the LLM. These are
--    the prime candidates for the swipe-UI human-in-the-loop pass.
-- =====================================================================
SELECT
  s.id,
  s.webcam_id,
  ROUND((s.calculated_rating / 5.0)::numeric, 2)        AS human_norm,
  ROUND(s.llm_quality::numeric, 2)                      AS llm_quality,
  ROUND(ABS(s.llm_quality - (s.calculated_rating / 5.0))::numeric, 2)
                                                        AS abs_diff,
  COUNT(r.id)                                           AS human_rater_count,
  ROUND(s.llm_confidence::numeric, 2)                   AS llm_confidence,
  s.llm_rating_explanation,
  s.firebase_url
FROM webcam_snapshots s
LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
WHERE s.llm_quality IS NOT NULL
  AND s.calculated_rating IS NOT NULL
GROUP BY s.id
HAVING COUNT(r.id) >= 2
   AND ABS(s.llm_quality - (s.calculated_rating / 5.0)) >= 0.30
ORDER BY abs_diff DESC
LIMIT 50;

-- =====================================================================
-- 6. Live progress while a rater run is in flight.
--    Refresh every ~30s. Shows pct done + throughput over last 5 min.
-- =====================================================================
SELECT
  COUNT(*) FILTER (WHERE llm_quality IS NOT NULL)       AS rated,
  COUNT(*) FILTER (WHERE llm_quality IS NULL
                   AND firebase_url IS NOT NULL)        AS remaining,
  ROUND(100.0
        * COUNT(*) FILTER (WHERE llm_quality IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE firebase_url IS NOT NULL), 0), 1)
                                                        AS pct_done,
  COUNT(*) FILTER (WHERE llm_rated_at > NOW() - INTERVAL '5 minutes')
                                                        AS last_5min,
  ROUND(COUNT(*) FILTER (WHERE llm_rated_at > NOW() - INTERVAL '5 minutes')
        / 5.0, 1)                                       AS images_per_min,
  MAX(llm_rated_at)                                     AS most_recent_rating
FROM webcam_snapshots;

-- =====================================================================
-- 7. Per-webcam summary. Identifies the best (and worst) cameras in the
--    fleet — useful for deciding which webcams to keep, drop, or boost
--    in the gallery.
-- =====================================================================
SELECT
  webcam_id,
  COUNT(*)                                              AS rated,
  ROUND(AVG(llm_quality)::numeric, 2)                   AS avg_q,
  ROUND(MAX(llm_quality)::numeric, 2)                   AS best_q,
  COUNT(*) FILTER (WHERE llm_is_sunset)                 AS sunset_count,
  COUNT(*) FILTER (WHERE llm_quality >= 0.7)            AS great_count,
  COUNT(*) FILTER (WHERE llm_obstruction IS NOT NULL)   AS obstructed
FROM webcam_snapshots
WHERE llm_quality IS NOT NULL
GROUP BY webcam_id
ORDER BY avg_q DESC, great_count DESC;

-- =====================================================================
-- 8. Time-of-day vs quality. Sanity check: golden_hour rows should
--    average higher quality than day/night rows. If they don't, the
--    LLM is mis-classifying time of day or the prompt needs tweaks.
-- =====================================================================
SELECT
  llm_time_of_day,
  COUNT(*)                                              AS n,
  ROUND(AVG(llm_quality)::numeric, 2)                   AS avg_q,
  COUNT(*) FILTER (WHERE llm_is_sunset)                 AS sunsets,
  COUNT(*) FILTER (WHERE llm_is_sunrise)                AS sunrises
FROM webcam_snapshots
WHERE llm_time_of_day IS NOT NULL
GROUP BY llm_time_of_day
ORDER BY avg_q DESC NULLS LAST;

-- =====================================================================
-- 9. Sky coverage distribution. If "none" or "partial" are most of your
--    dataset, many cameras are pointed at the wrong things and should be
--    excluded from the training set.
-- =====================================================================
SELECT
  llm_sky_coverage,
  COUNT(*)                                              AS n,
  ROUND(AVG(llm_quality)::numeric, 2)                   AS avg_q
FROM webcam_snapshots
WHERE llm_sky_coverage IS NOT NULL
GROUP BY llm_sky_coverage
ORDER BY
  CASE llm_sky_coverage
    WHEN 'full'    THEN 1
    WHEN 'mostly'  THEN 2
    WHEN 'partial' THEN 3
    WHEN 'none'    THEN 4
    ELSE 5
  END;

-- =====================================================================
-- 10. Obstruction breakdown. Which kinds of obstruction are most
--     common? Drives prioritization for cleaning the dataset.
-- =====================================================================
SELECT
  llm_obstruction,
  COUNT(*)                                              AS n,
  ROUND(AVG(llm_quality)::numeric, 2)                   AS avg_q
FROM webcam_snapshots
WHERE llm_obstruction IS NOT NULL
GROUP BY llm_obstruction
ORDER BY n DESC
LIMIT 25;

-- =====================================================================
-- 11. Spot-check a single record (replace 12345 with the snapshot id).
--     Returns one row with everything the LLM said about this image.
-- =====================================================================
SELECT
  s.id,
  s.webcam_id,
  s.captured_at,
  s.firebase_url,
  s.calculated_rating                       AS human_rating,
  s.llm_quality,
  s.llm_confidence,
  s.llm_is_sunset,
  s.llm_is_sunrise,
  s.llm_has_clouds,
  s.llm_time_of_day,
  s.llm_sky_coverage,
  s.llm_color_palette,
  s.llm_obstruction,
  s.llm_rating_explanation,
  s.llm_metadata,
  s.llm_provider,
  s.llm_model,
  s.llm_rated_at
FROM webcam_snapshots s
WHERE s.id = 12345;

-- =====================================================================
-- 12. Cost telemetry stub. Once we start logging input/output token
--     counts in llm_metadata, this query rolls them up. Until then
--     it returns zeros (safe to leave in place).
-- =====================================================================
SELECT
  llm_provider,
  llm_model,
  COUNT(*)                                  AS n,
  COALESCE(SUM((llm_metadata->>'input_tokens')::int), 0)   AS total_input_tokens,
  COALESCE(SUM((llm_metadata->>'output_tokens')::int), 0)  AS total_output_tokens
FROM webcam_snapshots
WHERE llm_metadata IS NOT NULL
GROUP BY llm_provider, llm_model
ORDER BY n DESC;
