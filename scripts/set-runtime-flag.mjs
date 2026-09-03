// scripts/set-runtime-flag.mjs
//
// Flips a runtime_flags row. This is the switch the pool-coverage spec's cost
// condition asks for: it takes effect on the next cron tick, with no code
// change and no redeploy.
//
// Dry by default, matching apply-migration.mjs and the backfill scripts.
// Every env file here points at the SAME Neon endpoint, so every --apply run
// is a production change.
//
//   node scripts/set-runtime-flag.mjs                              # list
//   node scripts/set-runtime-flag.mjs sweep_force_day_ring on
//   node scripts/set-runtime-flag.mjs sweep_force_day_ring on --apply
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sql = neon(loadDatabaseUrl());
const [key, state] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');

const rows = await sql`SELECT key, enabled, note, updated_at FROM runtime_flags ORDER BY key`;
console.log('current flags:');
for (const r of rows) console.log(`  ${r.key} = ${r.enabled}  (${r.updated_at.toISOString?.() ?? r.updated_at})`);

if (!key) process.exit(0);

if (state !== 'on' && state !== 'off') {
  console.error('usage: node scripts/set-runtime-flag.mjs <key> <on|off> [--apply]');
  process.exit(1);
}
if (!rows.some((r) => r.key === key)) {
  console.error(`no such flag: ${key}. Apply the migration that seeds it first.`);
  process.exit(1);
}

const enabled = state === 'on';
if (!apply) {
  console.log(`\nDRY RUN. Would set ${key} = ${enabled}. Re-run with --apply.`);
  process.exit(0);
}
await sql`UPDATE runtime_flags SET enabled = ${enabled}, updated_at = now() WHERE key = ${key}`;
console.log(`\n${key} = ${enabled}. Takes effect on the next cron tick.`);
