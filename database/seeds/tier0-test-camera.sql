-- Tier 0 hand-create: one custom camera + paired webcams row + active
-- terminator state row. Idempotent: re-running with the same :hardware_id
-- updates the device_token_hash and resets active=true.
--
-- Required psql variables (set by the wrapper script):
--   :hardware_id              text  e.g. 'pi-zero-2w-tier0-jesse-house'
--   :device_token_hash        text  64-char lowercase hex SHA-256
--   :lat                      numeric
--   :lng                      numeric
--   :timezone                 text
--   :title                    text  human-readable camera name (used in mosaic)
--   :phase                    text  'sunrise' or 'sunset'
--
-- Example direct invocation (without the wrapper):
--   psql "$DATABASE_URL" \
--     -v hardware_id="'pi-zero-2w-tier0-jesse-house'" \
--     -v device_token_hash="'2cf2...9824'" \
--     -v lat="47.6062" -v lng="-122.3321" \
--     -v timezone="'America/Los_Angeles'" \
--     -v title="'Tier 0 Test Camera'" -v phase="'sunset'" \
--     -f database/seeds/tier0-test-camera.sql

BEGIN;

-- 1. cameras row (upsert by hardware_id).
INSERT INTO cameras (
  hardware_id, device_token_hash, device_class, lat, lng, timezone,
  phase_preference, status
)
VALUES (
  :hardware_id, :device_token_hash, 'rpi-zero-2w', :lat, :lng, :timezone,
  :phase, 'active'
)
ON CONFLICT (hardware_id) DO UPDATE SET
  device_token_hash = EXCLUDED.device_token_hash,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  timezone = EXCLUDED.timezone,
  status = 'active';

-- 2. paired webcams row (source='custom', external_id=hardware_id).
INSERT INTO webcams (
  source, external_id, title, status, lat, lng,
  custom_camera_id, last_fetched_at, created_at, updated_at
)
SELECT 'custom', c.hardware_id, :title, 'active', c.lat, c.lng,
       c.id, NOW(), NOW(), NOW()
FROM cameras c
WHERE c.hardware_id = :hardware_id
ON CONFLICT (source, external_id) DO UPDATE SET
  title = EXCLUDED.title,
  status = 'active',
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  updated_at = NOW();

-- 3. cameras.webcam_id back-pointer.
UPDATE cameras c
SET webcam_id = w.id
FROM webcams w
WHERE c.hardware_id = :hardware_id
  AND w.source = 'custom'
  AND w.external_id = c.hardware_id;

-- 4. terminator_webcam_state row (active=true so the mosaic surfaces it).
INSERT INTO terminator_webcam_state (
  webcam_id, phase, rank, last_seen_at, updated_at, active
)
SELECT c.webcam_id, :phase, 0, NOW(), NOW(), true
FROM cameras c
WHERE c.hardware_id = :hardware_id
ON CONFLICT (webcam_id, phase) DO UPDATE SET
  active = true,
  rank = 0,
  last_seen_at = NOW(),
  updated_at = NOW();

COMMIT;

-- Final: print the camera_id so the wrapper script can echo it.
SELECT id AS camera_id
FROM cameras
WHERE hardware_id = :hardware_id;
