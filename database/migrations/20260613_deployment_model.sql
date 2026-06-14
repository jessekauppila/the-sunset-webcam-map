-- Deployment model (spec 2026-06-13-deployment-model-reconciliation-design §4/§12).
-- Evolve webcams into the 1:many deployment table; a custom camera owns many
-- webcams rows (one per deployment). All new columns nullable/defaulted so the
-- thousands of Windy rows (state IS NULL) are untouched.
--
-- webcams NOT NULL (no default) the deployment INSERT must supply (verified \d):
--   source, external_id, lat, lng.  UNIQUE(source, external_id) → external_id
--   must be unique per deployment (use custom-{cameraId}-{Date.now()}).
--
-- Forward-only, idempotent. Apply BEFORE the retargeted routes deploy.
--   psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model.sql

-- Deployment lifecycle
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS state TEXT;            -- testing|deployed|ended (NULL = windy)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;  -- NULL = active

-- Placement (lat/lng already exist on webcams)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS azimuth_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS tilt_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS elevation_m NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS horizon_altitude_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS horizon_profile JSONB;

-- Provenance (moved off cameras)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS azimuth_source TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS coarse BOOLEAN;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS bracket JSONB;

-- Operator prefs (moved off cameras)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS phase_preference TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS delivery_preferences JSONB;

-- Fast active-deployment lookup AND the one-active-deployment-per-camera invariant.
-- UNIQUE so a concurrent double-commit errors instead of silently creating two
-- active rows (upsertActiveDeployment ends-then-inserts, so the steady state is
-- always <=1 active row; this index is the safety net under races).
CREATE UNIQUE INDEX IF NOT EXISTS webcams_active_deployment_idx
  ON webcams (custom_camera_id)
  WHERE source = 'custom' AND ended_at IS NULL;

-- The one camera-level piece of the superseded lifecycle migration.
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS wifi_wipe_requested BOOLEAN NOT NULL DEFAULT FALSE;
