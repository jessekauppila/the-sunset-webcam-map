-- Either-order registration: a cameras row may now arrive populated from
-- pre-register (with placement, awaiting device) OR from register (with
-- device, awaiting placement). Relax NOT NULL on location fields; the
-- application enforces "ready" via app/lib/cameraRegistration.ts.
--
-- Forward-only. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260516_cameras_either_order_registration.sql

ALTER TABLE cameras ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE cameras ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE cameras ALTER COLUMN timezone DROP NOT NULL;

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS claim_code TEXT;
CREATE INDEX IF NOT EXISTS cameras_claim_code_idx ON cameras (claim_code);
