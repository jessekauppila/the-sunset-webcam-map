// Prints the Neon usage log the Ops tab reads: daily compute-hours per
// project, cost-change events, and a month-to-date dollar estimate.
// Run from the repo root (needs DATABASE_URL in .env.local):
//   node scripts/usage-report.mjs [days]   (default 30)
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const LABELS = {
  'noisy-leaf-96391119': 'sunset ',
  'rough-resonance-57753560': 'nwac   ',
};
const COST_PER_CU_HOUR = 0.14; // estimate; invoice of record is Vercel billing

const days = Number(process.argv[2] ?? 30);
const url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
if (!url) throw new Error('DATABASE_URL not found in .env.local — run from the repo root');
const sql = neon(url);

const usage = await sql.query(
  `SELECT day::text AS day, project_id, compute_time_s::bigint AS s
   FROM provider_usage_daily WHERE day > CURRENT_DATE - $1::int
   ORDER BY day, project_id`,
  [days],
);
const events = await sql.query(
  `SELECT occurred_on::text AS d, description FROM cost_events ORDER BY occurred_on`,
);
const rows = (usage.rows ?? usage).map((r) => ({ ...r, s: Number(r.s) }));
const eventsByDay = new Map((events.rows ?? events).map((e) => [e.d, e.description]));

// day-over-day deltas per project; counter resets at month start
const byProject = new Map();
for (const r of rows) {
  if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
  byProject.get(r.project_id).push(r);
}
const deltas = new Map(); // day -> {project: hours}
for (const [pid, list] of byProject) {
  for (let i = 1; i < list.length; i++) {
    const d = list[i].s - list[i - 1].s;
    const hours = (d < 0 ? list[i].s : d) / 3600;
    if (!deltas.has(list[i].day)) deltas.set(list[i].day, {});
    deltas.get(list[i].day)[pid] = hours;
  }
}

console.log('day         sunset  nwac    other   events');
for (const day of [...deltas.keys()].sort()) {
  const v = deltas.get(day);
  let sunset = 0, nwac = 0, other = 0;
  for (const [pid, h] of Object.entries(v)) {
    if (pid === 'noisy-leaf-96391119') sunset = h;
    else if (pid === 'rough-resonance-57753560') nwac = h;
    else other += h;
  }
  const flag = eventsByDay.has(day) ? `  ⚑ ${eventsByDay.get(day).slice(0, 50)}` : '';
  console.log(
    `${day}  ${sunset.toFixed(1).padStart(5)}h ${nwac.toFixed(1).padStart(5)}h ${other.toFixed(1).padStart(5)}h${flag}`,
  );
}
if (deltas.size === 0) console.log('(no deltas yet — needs two daily snapshots)');

// MTD from latest counter per project
let mtd = 0;
console.log('\nmonth-to-date counters:');
for (const [pid, list] of byProject) {
  const h = list.at(-1).s / 3600;
  mtd += h;
  console.log(`  ${LABELS[pid] ?? pid}  ${h.toFixed(1)} CU-hr (as of ${list.at(-1).day})`);
}
console.log(`  TOTAL   ${mtd.toFixed(1)} CU-hr ≈ $${(mtd * COST_PER_CU_HOUR).toFixed(2)} compute MTD`);

console.log('\ncost events:');
for (const [d, desc] of eventsByDay) console.log(`  ${d} — ${desc}`);
