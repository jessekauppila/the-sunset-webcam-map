-- Extend the LLM rating columns with high-value, app-facing fields and a
-- catch-all JSONB bucket for future-proofing.
--
-- Why each column earns its keep:
--   llm_is_sunrise           — disambiguates morning sunrises from evening
--                              sunsets (currently conflated by is_sunset).
--   llm_time_of_day          — sanity-check vs. snapshot timestamp; useful
--                              filter ("show me golden hour shots").
--   llm_sky_coverage         — exclude webcams pointed at trees/buildings
--                              from training set; useful gallery filter.
--   llm_rating_explanation   — natural-language reason for the score.
--                              Indispensable for debugging and for swipe-UI
--                              tooltips during human-in-the-loop.
--   llm_metadata (JSONB)     — catch-all for prompt version, raw model
--                              fields, and anything we add later. Keeps us
--                              from needing another schema migration when
--                              the prompt evolves.
--
-- Composite indexes:
--   webcam_snapshots_great_sunsets_idx — powers the gallery query
--     "WHERE llm_is_sunset = true ORDER BY llm_quality DESC".
--   webcam_snapshots_webcam_quality_idx — powers per-webcam timelines
--     "this webcam's recent best frames".
--
-- Tolerant: each block uses to_regclass() so missing tables (e.g.
-- external_images) are skipped, not errors. Re-running is a no-op.

-- ---------------------------------------------------------------------
-- webcam_snapshots
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.webcam_snapshots') IS NULL THEN
    RAISE NOTICE 'webcam_snapshots does not exist; skipping extended LLM columns.';
    RETURN;
  END IF;

  ALTER TABLE webcam_snapshots
    ADD COLUMN IF NOT EXISTS llm_is_sunrise          BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_time_of_day         TEXT,
    ADD COLUMN IF NOT EXISTS llm_sky_coverage        TEXT,
    ADD COLUMN IF NOT EXISTS llm_rating_explanation  TEXT,
    ADD COLUMN IF NOT EXISTS llm_metadata            JSONB;

  -- Single-column secondary indexes for the new categorical fields.
  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_time_of_day_idx
    ON webcam_snapshots (llm_time_of_day)
    WHERE llm_time_of_day IS NOT NULL;

  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_sky_coverage_idx
    ON webcam_snapshots (llm_sky_coverage)
    WHERE llm_sky_coverage IS NOT NULL;

  -- Gallery query: "best sunsets across the dataset".
  -- Partial index keeps it small (only sunset rows) and the DESC order
  -- means ORDER BY ... LIMIT N is satisfied by an index scan.
  CREATE INDEX IF NOT EXISTS webcam_snapshots_great_sunsets_idx
    ON webcam_snapshots (llm_quality DESC)
    WHERE llm_is_sunset = true AND llm_quality IS NOT NULL;

  -- Per-webcam timeline query: "this webcam's best/most recent frames".
  CREATE INDEX IF NOT EXISTS webcam_snapshots_webcam_quality_idx
    ON webcam_snapshots (webcam_id, llm_quality DESC NULLS LAST)
    WHERE llm_quality IS NOT NULL;

  -- GIN index on the JSONB bucket so future ad-hoc queries against
  -- llm_metadata->>'something' stay fast as the column fills out.
  CREATE INDEX IF NOT EXISTS webcam_snapshots_llm_metadata_gin
    ON webcam_snapshots USING gin (llm_metadata)
    WHERE llm_metadata IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------
-- external_images (tolerant: only if the table exists)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.external_images') IS NULL THEN
    RAISE NOTICE 'external_images does not exist; skipping extended LLM columns.';
    RETURN;
  END IF;

  ALTER TABLE external_images
    ADD COLUMN IF NOT EXISTS llm_is_sunrise          BOOLEAN,
    ADD COLUMN IF NOT EXISTS llm_time_of_day         TEXT,
    ADD COLUMN IF NOT EXISTS llm_sky_coverage        TEXT,
    ADD COLUMN IF NOT EXISTS llm_rating_explanation  TEXT,
    ADD COLUMN IF NOT EXISTS llm_metadata            JSONB;

  CREATE INDEX IF NOT EXISTS external_images_llm_time_of_day_idx
    ON external_images (llm_time_of_day)
    WHERE llm_time_of_day IS NOT NULL;

  CREATE INDEX IF NOT EXISTS external_images_great_sunsets_idx
    ON external_images (llm_quality DESC)
    WHERE llm_is_sunset = true AND llm_quality IS NOT NULL;

  CREATE INDEX IF NOT EXISTS external_images_llm_metadata_gin
    ON external_images USING gin (llm_metadata)
    WHERE llm_metadata IS NOT NULL;
END $$;
