-- kiosk_deploys: one row per studio Deploy (spec:
-- docs/superpowers/specs/2026-09-05-studio-deploy-history-and-solo-preview-design.md §2.1).
-- `namespaces` is { namespace: deviations }, the same deviations-only blobs
-- kiosk_settings.data holds, captured exactly as they were copied to live.
-- Loading a row back sanitizes each namespace through its current schema, so
-- adding/renaming/removing knobs never needs a migration here either.
--
-- Seeds deploy #1 from the current live profile when the table is empty, so
-- "what was on the glass before deploy history" is recoverable from day one.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_deploys (
  id           SERIAL PRIMARY KEY,
  label        TEXT,
  namespaces   JSONB NOT NULL,
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO kiosk_deploys (label, namespaces)
SELECT 'before deploy history', COALESCE(jsonb_object_agg(namespace, data), '{}'::jsonb)
FROM kiosk_settings
WHERE profile = 'live'
  AND NOT EXISTS (SELECT 1 FROM kiosk_deploys);
