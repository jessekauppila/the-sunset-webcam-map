-- Step 1 — does camera 4 have a paired webcams row + snapshots?
-- Run:  psql "$DATABASE_URL" -f .superpowers/camera4-bringup/1-check-camera4.sql
-- If webcam_id is NULL → it's unpaired; run 2-pair-camera4.sql before uploading.
SELECT
  c.id                       AS camera_id,
  c.hardware_id,
  c.status                   AS camera_status,
  c.webcam_id,                                   -- NULL = NOT paired (snapshot POST will 404)
  w.id                       AS webcams_row_id,
  w.source                   AS webcam_source,
  w.status                   AS webcam_status,
  (SELECT count(*) FROM webcam_snapshots s WHERE s.webcam_id = c.webcam_id) AS snapshot_count,
  c.phase_preference,
  c.last_heartbeat_at,
  c.last_seen_at
FROM cameras c
LEFT JOIN webcams w ON w.id = c.webcam_id
WHERE c.id = 4;
