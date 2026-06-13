-- Step 2 — pair camera 4 with a webcams row, ONLY if step 1 showed webcam_id IS NULL.
-- Idempotent and TOKEN-PRESERVING: it does NOT touch device_token_hash, so the
-- device's existing token on the Pi keeps working (unlike re-running the full
-- tier0-create-camera.sh wrapper, which mints a NEW token).
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f .superpowers/camera4-bringup/2-pair-camera4.sql
BEGIN;

-- 2a. paired webcams row (source='custom', external_id=hardware_id), derived
--     entirely from the existing cameras row — no new data needed.
INSERT INTO webcams (
  source, external_id, title, status, lat, lng,
  custom_camera_id, last_fetched_at, created_at, updated_at
)
SELECT 'custom', c.hardware_id, c.hardware_id, 'active', c.lat, c.lng,
       c.id, NOW(), NOW(), NOW()
FROM cameras c
WHERE c.id = 4
ON CONFLICT (source, external_id) DO UPDATE SET
  status = 'active',
  custom_camera_id = EXCLUDED.custom_camera_id,
  updated_at = NOW();

-- 2b. cameras.webcam_id back-pointer.
UPDATE cameras c
SET webcam_id = w.id
FROM webcams w
WHERE c.id = 4
  AND w.source = 'custom'
  AND w.external_id = c.hardware_id;

-- 2c. terminator_webcam_state so the camera surfaces in the existing query path.
INSERT INTO terminator_webcam_state (
  webcam_id, phase, rank, last_seen_at, updated_at, active
)
SELECT c.webcam_id,
       CASE WHEN c.phase_preference IN ('sunrise','sunset')
            THEN c.phase_preference ELSE 'sunset' END,
       0, NOW(), NOW(), true
FROM cameras c
WHERE c.id = 4 AND c.webcam_id IS NOT NULL
ON CONFLICT (webcam_id, phase) DO UPDATE SET
  active = true, rank = 0, last_seen_at = NOW(), updated_at = NOW();

COMMIT;

-- verify:
SELECT id AS camera_id, hardware_id, webcam_id FROM cameras WHERE id = 4;
