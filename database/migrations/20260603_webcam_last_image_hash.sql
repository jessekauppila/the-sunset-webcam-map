-- Move the per-camera image-hash cache from Upstash Redis into Neon.
--
-- The cron (update-cameras) used to GET/SET a Redis key per webcam every
-- tick to skip re-scoring unchanged frames. At a 1-minute cadence that was
-- the dominant Upstash command consumer and blew the 500k/month free quota.
-- Storing the hash on the webcam row folds the read into the existing
-- batched id lookup and the write into the existing AI-fields UPDATE, so
-- Redis no longer scales with webcam volume (it now only holds the
-- terminator payload cache).
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260603_webcam_last_image_hash.sql
--
-- Existing rows stay NULL (= "no prior hash") and get re-scored once,
-- which repopulates the column on the next tick.

ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS last_image_hash TEXT;
