-- Pair camera 1 with a fresh webcams row (token-preserving; idempotent).
-- Derives everything from the existing cameras row — no new data needed.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f pair-camera-1.sql
BEGIN;
INSERT INTO webcams (source, external_id, title, status, lat, lng, custom_camera_id, last_fetched_at, created_at, updated_at)
SELECT 'custom', c.hardware_id, c.hardware_id, 'active', c.lat, c.lng, c.id, NOW(), NOW(), NOW()
FROM cameras c WHERE c.id = 1
ON CONFLICT (source, external_id) DO UPDATE SET status='active', custom_camera_id=EXCLUDED.custom_camera_id, updated_at=NOW();

UPDATE cameras c SET webcam_id = w.id
FROM webcams w WHERE c.id = 1 AND w.source='custom' AND w.external_id = c.hardware_id;

INSERT INTO terminator_webcam_state (webcam_id, phase, rank, last_seen_at, updated_at, active)
SELECT c.webcam_id, CASE WHEN c.phase_preference IN ('sunrise','sunset') THEN c.phase_preference ELSE 'sunset' END, 0, NOW(), NOW(), true
FROM cameras c WHERE c.id = 1 AND c.webcam_id IS NOT NULL
ON CONFLICT (webcam_id, phase) DO UPDATE SET active=true, rank=0, last_seen_at=NOW(), updated_at=NOW();
COMMIT;
SELECT c.id AS camera_id, c.hardware_id, c.webcam_id, c.lat, c.lng, w.status AS webcam_status
FROM cameras c JOIN webcams w ON w.id = c.webcam_id WHERE c.id = 1;
