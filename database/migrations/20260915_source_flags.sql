-- source_faa / source_digitraffic: the runtime flags that turn a non-Windy
-- image source on (issues #204 and #221).
--
-- Both adapters and the registry merged on 2026-09-15 without this seed, and
-- isFlagEnabled fails closed on a missing row -- correct as a safety property,
-- but it meant there was no command that could turn either source on. This is
-- that seed. Same table, same semantics as 20260902_runtime_flags.sql: an ops
-- switch that takes effect on the next cron tick with no redeploy.
--
-- Seeded OFF, like every flag here. Turning one on is a separate, deliberate
-- act via scripts/set-runtime-flag.mjs, because each source is a standing
-- bill: the cron persists every scored frame and the cleanup does not run.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260915_source_flags.sql --apply

INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'source_faa',
  false,
  'List FAA Weathercams (Alaska) as a non-Windy source each tick. Needs FAA_WEATHERCAMS_TOKEN. Without it the adapter lists nothing and counts one unconfigured failure.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'source_digitraffic',
  false,
  'List Finland Digitraffic road weather cameras as a non-Windy source each tick. No auth. Adds one stations GET plus one HEAD per in-band preset per tick.'
)
ON CONFLICT (key) DO NOTHING;
