-- kiosk_scenes: frozen kiosk input states for /studio replay + the grant
-- archive (spec: docs/superpowers/specs/2026-08-30-kiosk-scenes-design.md).
-- state is the MosaicProps-shaped pool; provenance records what was live at
-- capture (null for reconstructed scenes). state is immutable after insert.
-- Apply with:
--   psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_scenes.sql
CREATE TABLE IF NOT EXISTS kiosk_scenes (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  represents_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'historical')),
  state JSONB NOT NULL,
  provenance JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
