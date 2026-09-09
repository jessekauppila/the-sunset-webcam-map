// scripts/run-inventory.mjs
//
// What run corpus exists, and how much of it is uniform rather than
// model-selected. Read this before starting a labeling sitting.
//
// A run is one camera's one evening, keyed on LOCAL SOLAR date (longitude / 15
// hours). A fixed UTC offset splits western-hemisphere evenings in half.
//
// This query MIRRORS app/lib/runKey.ts, which is the definition of record. The
// duplication exists because a .mjs script cannot import a .ts module; change
// both or neither.
//
//   node scripts/run-inventory.mjs
//   node scripts/run-inventory.mjs --days 30
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
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg === -1 ? 45 : Number(process.argv[daysArg + 1]);

const runs = await sql`
  WITH framed AS (
    SELECT s.id, s.webcam_id, s.phase, s.intake_reason,
           s.captured_at,
           ((s.captured_at AT TIME ZONE 'UTC'
             + make_interval(mins => (w.lng / 15.0 * 60)::int)))::date AS solar_day
    FROM webcam_snapshots s
    JOIN webcams w ON w.id = s.webcam_id
    WHERE s.captured_at > now() - make_interval(days => ${DAYS}::int)
      AND s.phase = 'sunset'
      AND w.lng IS NOT NULL
  ),
  grouped AS (
    SELECT webcam_id, solar_day,
           count(*)::int AS frames,
           count(*) FILTER (WHERE intake_reason = 'run')::int AS run_frames,
           extract(epoch FROM (max(captured_at) - min(captured_at))) / 60 AS span_min
    FROM framed GROUP BY webcam_id, solar_day
  )
  SELECT
    count(*) FILTER (WHERE frames >= 6 AND span_min BETWEEN 30 AND 150)::int AS labelable_runs,
    count(*) FILTER (WHERE frames >= 6 AND span_min BETWEEN 30 AND 150
                       AND run_frames = frames)::int AS uniform_runs,
    count(DISTINCT webcam_id) FILTER (WHERE run_frames > 0)::int AS panel_cameras_seen,
    round(avg(frames) FILTER (WHERE run_frames = frames)::numeric, 1) AS avg_frames_uniform
  FROM grouped
`;
console.log(`window: last ${DAYS} days, sunset phase`);
console.table(runs);

const mix = await sql`
  SELECT coalesce(intake_reason, '(null)') AS reason, count(*)::int AS frames
  FROM webcam_snapshots
  WHERE captured_at > now() - make_interval(days => ${DAYS}::int)
  GROUP BY 1 ORDER BY 2 DESC
`;
console.log('intake mix over the same window:');
console.table(mix);
