-- Backfill: each existing custom camera's webcams row becomes its active
-- deployment (spec §12.2). Copy placement from the cameras row where the webcams
-- column is still NULL. camera 1 (the bench unit) → state='testing'.
--
-- PROD-SAFE: prod `cameras` has NO azimuth_source/coarse/bracket columns (the
-- bracket-provenance migration was never applied — it's superseded), so this does
-- NOT reference them; those webcams provenance columns stay NULL for backfilled
-- rows (camera 1 has no bracket data). New deployments fill them via the wizard.
--
-- Idempotent: only touches custom rows with state IS NULL.
--   psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model_backfill.sql

UPDATE webcams w SET
  state = COALESCE(w.state, 'testing'),
  started_at = COALESCE(w.started_at, w.created_at, NOW()),
  ended_at = NULL,
  azimuth_deg = COALESCE(w.azimuth_deg, c.azimuth_deg),
  tilt_deg = COALESCE(w.tilt_deg, c.tilt_deg),
  elevation_m = COALESCE(w.elevation_m, c.elevation_m),
  timezone = COALESCE(w.timezone, c.timezone),
  horizon_altitude_deg = COALESCE(w.horizon_altitude_deg, c.horizon_altitude_deg),
  horizon_profile = COALESCE(w.horizon_profile, c.horizon_profile),
  phase_preference = COALESCE(w.phase_preference, c.phase_preference),
  delivery_preferences = COALESCE(w.delivery_preferences, c.delivery_preferences)
FROM cameras c
WHERE w.custom_camera_id = c.id
  AND w.source = 'custom'
  AND w.state IS NULL;

-- Ensure cameras.webcam_id points at the (single) active deployment.
UPDATE cameras c SET webcam_id = w.id
FROM webcams w
WHERE w.custom_camera_id = c.id AND w.source = 'custom' AND w.ended_at IS NULL
  AND (c.webcam_id IS DISTINCT FROM w.id);
