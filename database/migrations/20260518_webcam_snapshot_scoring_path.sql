-- Add per-snapshot scoring_path so the actual code path (onnx vs
-- baseline-fallback vs baseline) is queryable historically. Companion
-- to the per-tick scoringPaths counter shipped on 2026-05-18 — that
-- one shows live state, this one captures it on every row written.
--
-- Motivated by the v4 deploy on 2026-05-15: scoring_path would have
-- let a single SQL query find every contaminated row instead of
-- requiring a week of investigation.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260518_webcam_snapshot_scoring_path.sql
--
-- Historical rows stay NULL (= "we don't know") rather than backfilled —
-- false-attestation would be worse than absence here.

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS scoring_path TEXT;
