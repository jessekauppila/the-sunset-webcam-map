// scripts/scene-history-report.mjs
// Read-only report: how deep and how evenly webcam_snapshots history covers
// the clock/calendar. Run: node scripts/scene-history-report.mjs
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

const [range] = await sql`
  SELECT MIN(captured_at) AS oldest, MAX(captured_at) AS newest,
         COUNT(*)::int AS total,
         COUNT(DISTINCT webcam_id)::int AS webcams
  FROM webcam_snapshots`;
console.log('range:', range);

const byMonth = await sql`
  SELECT to_char(date_trunc('month', captured_at), 'YYYY-MM') AS month,
         COUNT(*)::int AS rows, COUNT(DISTINCT webcam_id)::int AS webcams
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(byMonth);

const byHourUtc = await sql`
  SELECT EXTRACT(HOUR FROM captured_at)::int AS hour_utc, COUNT(*)::int AS rows
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(byHourUtc);

const phaseCoverage = await sql`
  SELECT phase, COUNT(*)::int AS rows,
         COUNT(llm_quality)::int AS with_llm
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(phaseCoverage);
