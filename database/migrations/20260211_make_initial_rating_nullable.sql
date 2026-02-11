-- Allow AI-first snapshot capture flows to persist rows when no manual
-- seed rating is available at capture time.
ALTER TABLE webcam_snapshots
ALTER COLUMN initial_rating DROP NOT NULL;
