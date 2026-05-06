-- Round out the LLM rating columns on both image tables so the full
-- structured response from the vision LLM (is_sunset, confidence, clouds,
-- palette, obstruction, provider) is persisted alongside `llm_quality`.
--
-- Why: the prior migration (20260417_add_llm_quality_to_snapshots.sql)
-- only stored the quality score, but ml/llm_rater.py captures a richer
-- structured payload that we want to be queryable from SQL and from the
-- Next.js API (e.g. swipe UI: "show me only the low-confidence images
-- that the LLM flagged as obstructed").
--
-- Tolerant: each table is wrapped in a DO block that skips the ALTERs
-- if the table itself doesn't exist yet (e.g. external_images is only
-- created by 20260417_external_images.sql, which is opt-in for projects
-- that scrape Flickr). Re-running this migration is a no-op once all
-- columns are present.

-- ---------------------------------------------------------------------
-- webcam_snapshots
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.webcam_snapshots') IS NULL THEN
    RAISE NOTICE 'webcam_snapshots does not exist; skipping LLM metadata columns.';
    RETURN;
  END IF;

  ALTER TABLE webcam_snapshots
    ADD COLUMN IF NOT EXISTS llm_is_sunset      BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_confidence     REAL,
    ADD COLUMN IF NOT EXISTS llm_has_clouds     BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_color_palette  TEXT,
    ADD COLUMN IF NOT EXISTS llm_obstruction    TEXT,
    ADD COLUMN IF NOT EXISTS llm_provider       TEXT;

  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_is_sunset_idx
    ON webcam_snapshots (llm_is_sunset)
    WHERE llm_is_sunset IS NOT NULL;

  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_confidence_idx
    ON webcam_snapshots (llm_confidence)
    WHERE llm_confidence IS NOT NULL;

  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_obstruction_idx
    ON webcam_snapshots (llm_obstruction)
    WHERE llm_obstruction IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------
-- external_images (only if the table exists; otherwise harmless skip)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.external_images') IS NULL THEN
    RAISE NOTICE 'external_images does not exist; skipping LLM metadata columns. Apply 20260417_external_images.sql first if you plan to scrape Flickr.';
    RETURN;
  END IF;

  ALTER TABLE external_images
    ADD COLUMN IF NOT EXISTS llm_is_sunset      BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_has_clouds     BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_color_palette  TEXT,
    ADD COLUMN IF NOT EXISTS llm_obstruction    TEXT,
    ADD COLUMN IF NOT EXISTS llm_provider       TEXT;

  CREATE INDEX IF NOT EXISTS external_images_llm_is_sunset_idx
    ON external_images (llm_is_sunset)
    WHERE llm_is_sunset IS NOT NULL;

  CREATE INDEX IF NOT EXISTS external_images_llm_obstruction_idx
    ON external_images (llm_obstruction)
    WHERE llm_obstruction IS NOT NULL;
END $$;
