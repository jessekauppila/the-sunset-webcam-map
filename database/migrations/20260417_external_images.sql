-- External images scraped from Flickr, Unsplash, Pexels, etc.
-- Kept separate from webcam_snapshots to avoid polluting the production
-- snapshot pipeline, but schema is compatible for UNION ALL in export.

CREATE TABLE IF NOT EXISTS external_images (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,              -- 'flickr', 'unsplash', 'pexels'
  source_id TEXT NOT NULL,           -- original ID from the source platform
  image_url TEXT,                    -- Firebase Storage public URL (after upload)
  firebase_path TEXT,                -- storage path for cleanup/deletion
  original_url TEXT NOT NULL,        -- where the image was downloaded from
  license TEXT,                      -- 'cc-by-2.0', 'cc0', 'unsplash', etc.
  title TEXT,
  description TEXT,
  tags TEXT[],                       -- original tags from source
  owner TEXT,                        -- photographer username/ID
  width INT,
  height INT,
  category TEXT NOT NULL DEFAULT 'sunset',  -- 'sunset', 'negative'
  llm_quality DECIMAL(4,3),          -- 0.000-1.000, filled by llm_rater.py
  llm_confidence DECIMAL(4,3),       -- 0.000-1.000
  llm_model TEXT,                    -- 'gemini-2.0-flash', 'gpt-4o-mini'
  llm_rated_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_images_unique_source
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS external_images_source_idx
  ON external_images (source);

CREATE INDEX IF NOT EXISTS external_images_category_idx
  ON external_images (category);

CREATE INDEX IF NOT EXISTS external_images_llm_quality_idx
  ON external_images (llm_quality)
  WHERE llm_quality IS NOT NULL;
