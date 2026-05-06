-- Tier 0 cameras schema. Implements docs/device-protocol.md §10 in full so
-- later tiers (claim codes, heartbeat, edge ML, winner selection) do not
-- require additional migrations against the same tables.
--
-- Forward-only. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260503_cameras_schema.sql

-- 1. Single-use claim codes (table created now; admin endpoint is Tier 1).
CREATE TABLE IF NOT EXISTS camera_claim_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_camera_id INTEGER
);

CREATE INDEX IF NOT EXISTS camera_claim_codes_unconsumed_idx
  ON camera_claim_codes (code)
  WHERE consumed_at IS NULL;

-- 2. Custom edge cameras (the device-side primary key).
CREATE TABLE IF NOT EXISTS cameras (
  id SERIAL PRIMARY KEY,
  hardware_id TEXT NOT NULL UNIQUE,
  device_token_hash TEXT NOT NULL,
  webcam_id INTEGER,
  device_class TEXT NOT NULL DEFAULT 'rpi-zero-2w',
  firmware_version TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,

  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  elevation_m NUMERIC,
  timezone TEXT NOT NULL,
  location_source TEXT,

  azimuth_deg NUMERIC,
  tilt_deg NUMERIC,
  horizon_altitude_deg NUMERIC DEFAULT 0,
  horizon_profile JSONB,

  phase_preference TEXT NOT NULL DEFAULT 'both',
  delivery_preferences JSONB,

  status TEXT NOT NULL DEFAULT 'active',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cameras_status_idx ON cameras (status);
CREATE INDEX IF NOT EXISTS cameras_last_heartbeat_idx
  ON cameras (last_heartbeat_at DESC);

-- 3. Now that cameras exists, wire the FK from claim codes back to it.
ALTER TABLE camera_claim_codes
  DROP CONSTRAINT IF EXISTS camera_claim_codes_camera_fk;

ALTER TABLE camera_claim_codes
  ADD CONSTRAINT camera_claim_codes_camera_fk
  FOREIGN KEY (consumed_by_camera_id) REFERENCES cameras(id);

-- 4. Extend webcams with source discriminator + back-pointer.
ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'windy';

ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS custom_camera_id INTEGER REFERENCES cameras(id);

CREATE INDEX IF NOT EXISTS webcams_source_idx ON webcams (source);

-- 5. Wire the cameras.webcam_id back-pointer (cycle resolved by adding it
--    after both tables exist).
ALTER TABLE cameras
  DROP CONSTRAINT IF EXISTS cameras_webcam_fk;

ALTER TABLE cameras
  ADD CONSTRAINT cameras_webcam_fk
  FOREIGN KEY (webcam_id) REFERENCES webcams(id);

-- 6. Extend webcam_snapshots with edge ML + window fields. Tier 0 only writes
--    edge_score (NULL for v0 firmware) and window_id; the rest are reserved.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS edge_score NUMERIC;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS edge_model_version TEXT;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS window_id TEXT;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS is_window_winner BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS webcam_snapshots_window_id_idx
  ON webcam_snapshots (window_id);

CREATE INDEX IF NOT EXISTS webcam_snapshots_winners_idx
  ON webcam_snapshots (webcam_id, captured_at DESC)
  WHERE is_window_winner = TRUE;
