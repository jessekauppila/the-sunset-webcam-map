-- Bracket provenance for the cloud setup wizard (sub-project F).
-- The wizard's bracket flow submits a realized COARSE azimuth plus full
-- provenance; the Pi reads azimuth_source/coarse to drive sun self-refine
-- (integration contract I-5). bracket holds the prototype's output payload.
--
-- Forward-only, idempotent. Apply BEFORE shipping the routes that SELECT these
-- columns (register/heartbeat/pre-register), else they 500 for every camera.
-- Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260613_cameras_bracket_provenance.sql

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS azimuth_source TEXT;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS coarse BOOLEAN;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS bracket JSONB;
