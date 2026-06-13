-- Clean-slate renumber: make the bench unit (id=4) become id=1, token-preserving.
-- Deletes the retired jesse-house camera (id=1) and wipes the bench archive.
-- DESTRUCTIVE + IRREVERSIBLE (take a Neon branch first). Atomic: all-or-nothing.
-- Verified pre-flight 2026-06-12: id=1=jesse-house/26144288, id=4=sunset-cam-1/28759753,
-- 0 claim-code rows referencing either (the camera_claim_codes lines are no-ops, kept for safety).
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f renumber-to-camera-1.sql
BEGIN;

-- Guard: assert the expected rows exist, else abort the whole transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cameras WHERE id=4 AND hardware_id='pi-zero-2w-sunset-cam-1') THEN
    RAISE EXCEPTION 'Bench unit id=4/pi-zero-2w-sunset-cam-1 not found — aborting';
  END IF;
  IF EXISTS (SELECT 1 FROM cameras WHERE id=1 AND hardware_id<>'pi-zero-2w-tier0-jesse-house') THEN
    RAISE EXCEPTION 'id=1 is not the expected jesse-house row — aborting';
  END IF;
END $$;

-- 1. Delete retired jesse-house (id=1). Clear its FKs first.
DELETE FROM webcam_snapshots WHERE webcam_id = 26144288;       -- terminator_webcam_state cascades on webcam delete
UPDATE cameras SET webcam_id = NULL WHERE id = 1;               -- release cameras.webcam_fk
DELETE FROM webcams WHERE id = 26144288;                        -- custom_camera_id pointed at cameras(1); gone now
DELETE FROM camera_claim_codes WHERE consumed_by_camera_id = 1; -- release camera_claim_codes_camera_fk (0 rows)
DELETE FROM cameras WHERE id = 1;                               -- frees id=1

-- 2. Wipe the bench unit's archive + release every FK that references id=4 or its webcam.
DELETE FROM webcam_snapshots WHERE webcam_id = 28759753;        -- the 122 frames
UPDATE cameras SET webcam_id = NULL WHERE id = 4;               -- release cameras.webcam_fk
DELETE FROM webcams WHERE id = 28759753;                        -- terminator cascades
UPDATE camera_claim_codes SET consumed_by_camera_id = NULL WHERE consumed_by_camera_id = 4; -- 0 rows

-- 3. Move the row to id=1 (device_token_hash + hardware_id + all columns ride along).
UPDATE cameras SET id = 1 WHERE id = 4;

-- 4. Reset the sequence so the NEXT camera is 2.
SELECT setval('cameras_id_seq', 1, true);

COMMIT;

-- verify (read-only, after commit):
SELECT id, hardware_id, (device_token_hash IS NOT NULL) AS has_token, webcam_id, status
FROM cameras ORDER BY id;
