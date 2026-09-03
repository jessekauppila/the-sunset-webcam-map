// scripts/apply-migration.mjs
//
// Applies a file from database/migrations/ over the Neon HTTP driver, records
// it in the `schema_migrations` ledger, and reports what is still pending.
// There is no local psql and every env file here points at the SAME endpoint:
// there is no separate dev database, so every --apply is a production schema
// change. Dry by default, matching the backfill scripts.
//
//   node scripts/apply-migration.mjs --status
//       Every file in database/migrations/ against the ledger. Exit 1 if any
//       is pending, so it can gate a deploy.
//
//   node scripts/apply-migration.mjs database/migrations/<file>.sql
//   node scripts/apply-migration.mjs database/migrations/<file>.sql --apply
//       Dry-run prints the statements; --apply runs them one by one and then
//       records the file in the ledger.
//
//   node scripts/apply-migration.mjs database/migrations/<file>.sql --from <git-ref> --apply
//       Reads the file from a branch or commit instead of the working tree.
//       The shared checkout is usually on main while the migration is on the
//       PR branch; this applies it without switching anyone's branch.
//
//   node scripts/apply-migration.mjs --backfill --apply
//       One-time: records every file currently on disk as applied, with a
//       note. For adopting the ledger on a database that already carries all
//       of them. Refuses if the ledger already has rows.
//
// The driver sends one statement per request, so a multi-statement file is NOT
// atomic: a failure part way through leaves the earlier statements committed
// and the file unrecorded. The dry run prints the exact statement list so that
// partial state is predictable rather than discovered.
//
// Why a ledger: see docs/solutions/workflow-issues/migrations-need-a-ledger.md.
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { statementsOf, ledgerNameOf, statusOf, formatStatus } from './migration-ledger.mjs';

const MIGRATIONS_DIR = 'database/migrations';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

function usage() {
  console.error(
    'usage:\n' +
      '  node scripts/apply-migration.mjs --status\n' +
      '  node scripts/apply-migration.mjs <file.sql> [--from <git-ref>] [--apply]\n' +
      '  node scripts/apply-migration.mjs --backfill --apply',
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const wantStatus = argv.includes('--status');
const wantBackfill = argv.includes('--backfill');
const fromIdx = argv.indexOf('--from');
const fromRef = fromIdx >= 0 ? argv[fromIdx + 1] : null;
if (fromIdx >= 0 && !fromRef) usage();
const path = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from');

async function ensureLedger(sql) {
  await sql.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now(),
      note       text
    )`);
}

async function readLedger(sql) {
  const rows = await sql.query('select filename, applied_at, note from schema_migrations');
  return new Map(rows.map((r) => [r.filename, { applied_at: r.applied_at, note: r.note }]));
}

function filesOnDisk() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => `${MIGRATIONS_DIR}/${f}`);
}

async function record(sql, name, note) {
  await sql.query(
    `insert into schema_migrations (filename, note) values ($1, $2)
     on conflict (filename) do update set applied_at = now(), note = excluded.note`,
    [name, note],
  );
}

// --status: reconcile disk against the ledger. Exit 1 on anything pending.
if (wantStatus) {
  const sql = neon(loadDatabaseUrl());
  await ensureLedger(sql);
  const status = statusOf(filesOnDisk(), await readLedger(sql));
  console.log(formatStatus(status));
  process.exit(status.pending.length === 0 ? 0 : 1);
}

// --backfill: adopt the ledger on a database that already has every file applied.
if (wantBackfill) {
  const files = filesOnDisk().map(ledgerNameOf).sort();
  console.log(`${files.length} files on disk would be recorded as applied (backfill).`);
  if (!apply) {
    console.log('DRY RUN. Nothing was sent. Re-run with --apply to record them.');
    process.exit(0);
  }
  const sql = neon(loadDatabaseUrl());
  await ensureLedger(sql);
  const existing = await readLedger(sql);
  if (existing.size > 0) {
    console.error(`Refusing: the ledger already has ${existing.size} row(s). Backfill is for first adoption only.`);
    process.exit(1);
  }
  const note = `backfilled ${new Date().toISOString().slice(0, 10)}: present in production before the ledger existed`;
  for (const name of files) await record(sql, name, note);
  console.log(`Recorded ${files.length} migrations.`);
  process.exit(0);
}

if (!path) usage();

const sqlText = fromRef
  ? execFileSync('git', ['show', `${fromRef}:${path}`], { encoding: 'utf8' })
  : readFileSync(path, 'utf8');
const statements = statementsOf(sqlText);
const name = ledgerNameOf(path);
console.log(`${fromRef ? `${fromRef}:` : ''}${path}: ${statements.length} statement(s)\n`);
statements.forEach((s, i) => console.log(`[${i + 1}] ${s}\n`));

if (!apply) {
  console.log('DRY RUN. Nothing was sent. Re-run with --apply to execute.');
  process.exit(0);
}

const sql = neon(loadDatabaseUrl());
await ensureLedger(sql);
const already = (await readLedger(sql)).get(name);
if (already) {
  console.log(`note: ${name} is already recorded as applied at ${String(already.applied_at).slice(0, 19)}; re-applying (statements are expected to be idempotent).`);
}
for (const [i, statement] of statements.entries()) {
  process.stdout.write(`applying [${i + 1}/${statements.length}] ... `);
  try {
    await sql.query(statement);
    console.log('ok');
  } catch (e) {
    console.log('FAILED');
    console.error(`\n${e.message}\n`);
    console.error(`Statements 1..${i} are already committed and ${name} is NOT recorded. Fix and re-run`);
    console.error('the remaining statements individually; do not re-run the file.');
    process.exit(1);
  }
}
await record(sql, name, fromRef ? `applied from ${fromRef}` : null);
console.log(`\nAll statements applied. Recorded ${name} in schema_migrations.`);
