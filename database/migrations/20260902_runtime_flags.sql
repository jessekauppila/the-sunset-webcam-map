-- runtime_flags: booleans the cron reads at tick time (spec:
-- docs/superpowers/specs/2026-09-02-terminator-pool-coverage-design.md §4).
--
-- Deliberately NOT env vars. Env vars in this project bake in at deploy time,
-- so bringing spending back down through one would need a `vercel redeploy`.
-- The operator's condition on approving this spend was a switch that works
-- without a code change or a redeploy, and a table row is that switch.
--
-- Kept separate from kiosk_settings: that table is display dials, sanitized
-- against a versioned settings schema and copied studio -> live by the Deploy
-- button. An ops kill-switch has none of those semantics and must not inherit
-- them -- in particular it must never be copied by a profile deploy.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_runtime_flags.sql --apply

CREATE TABLE IF NOT EXISTS runtime_flags (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded OFF. Phase 1 flips it by hand for a bounded window; see
-- scripts/set-runtime-flag.mjs.
INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'sweep_force_day_ring',
  false,
  'Sweep the +15.75 day-side ring every tick regardless of TERMINATOR_CAMERA_FLOOR. Roughly doubles Windy boxes per tick.'
)
ON CONFLICT (key) DO NOTHING;
