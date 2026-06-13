-- Camera lifecycle: pause / decommission + the relocation WiFi-wipe directive
-- (sub-project F, plan Tasks 22/23; integration contract §12/§13).
--
-- GROUNDING NOTE: the F plan's Tasks 22/23 describe a deployment model
-- (a `deployments` table with `ended_at` / `state`). That model does NOT exist
-- yet — the only lifecycle field is `cameras.status` (TEXT, DEFAULT 'active',
-- already indexed by 20260503_cameras_schema.sql). So pause/decommission are
-- mapped onto `cameras.status`, and the camera row IS the unit of placement
-- for now. A future deployments table can layer archive/feed history on top
-- without reworking these endpoints. Status vocabulary:
--   'active'         — capturing (default)
--   'paused'         — capture suspended, resumable, WiFi + placement intact
--   'decommissioned' — turned off at this location; re-commission via the
--                      wizard (pre-register upsert) flips it back to 'active'
--
-- `wifi_wipe_requested` is the relocation directive: decommission-with-relocation
-- sets it TRUE; the next heartbeat surfaces a `wipe_wifi` directive and clears it.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260613_cameras_lifecycle.sql

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS wifi_wipe_requested BOOLEAN NOT NULL DEFAULT FALSE;
