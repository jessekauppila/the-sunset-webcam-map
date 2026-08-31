-- kiosk_settings: dial values for the kiosk studio (spec:
-- docs/superpowers/specs/2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md).
-- One row per (profile, namespace). 'studio' is the editing surface, 'live' is
-- what the glass reads; "Deploy to glass" copies studio -> live. The JSONB blob
-- stores ONLY values that deviate from the code-default in the version's
-- settingsSchema, so adding/renaming/removing knobs never needs a migration.
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_settings.sql

CREATE TABLE IF NOT EXISTS kiosk_settings (
  profile     TEXT NOT NULL CHECK (profile IN ('studio', 'live')),
  namespace   TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision    INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile, namespace)
);
