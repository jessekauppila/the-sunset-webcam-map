// scripts/seed-run-panel.mjs
//
// Chooses the whole-evening capture panel. Cameras that have actually produced
// operator-confirmed sunsets, spread across longitude so runs land at different
// UTC hours rather than all in one part of the world.
//
// Dry by default. Every env file here points at the SAME Neon endpoint, so
// every --apply run is a production change.
//
//   node scripts/seed-run-panel.mjs
//   node scripts/seed-run-panel.mjs --apply
//   node scripts/seed-run-panel.mjs --size 40 --apply
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
const apply = process.argv.includes('--apply');
const sizeArg = process.argv.indexOf('--size');
const SIZE = sizeArg === -1 ? 60 : Number(process.argv[sizeArg + 1]);
// 24 buckets of 15 degrees: one per hour of local solar time.
const BUCKETS = 24;

const candidates = await sql`
  SELECT w.id, w.lng, count(*)::int AS confirmed_sunsets
  FROM manual_labels m
  JOIN webcam_snapshots s ON s.id = m.image_id AND m.source = 'webcam'
  JOIN webcams w ON w.id = s.webcam_id
  WHERE m.is_sunset AND w.lng IS NOT NULL
  GROUP BY w.id, w.lng
  HAVING count(*) >= 3
  ORDER BY count(*) DESC
`;

// Round-robin across longitude buckets so the panel is not all one meridian.
const byBucket = new Map();
for (const c of candidates) {
  const b = Math.floor(((Number(c.lng) + 180) % 360) / (360 / BUCKETS));
  if (!byBucket.has(b)) byBucket.set(b, []);
  byBucket.get(b).push(c);
}

const picked = [];
let exhausted = false;
while (picked.length < SIZE && !exhausted) {
  exhausted = true;
  for (const list of byBucket.values()) {
    if (picked.length >= SIZE) break;
    const next = list.shift();
    if (next) {
      picked.push(next);
      exhausted = false;
    }
  }
}

console.log(`candidates: ${candidates.length}, buckets used: ${byBucket.size}`);
console.log(`picked ${picked.length} of a requested ${SIZE}:`);
for (const p of picked) {
  console.log(`  webcam ${p.id}  lng ${Number(p.lng).toFixed(1)}  ${p.confirmed_sunsets} confirmed sunsets`);
}

if (!apply) {
  console.log('\nDRY RUN. Re-run with --apply to write run_panel.');
  process.exit(0);
}

for (const p of picked) {
  await sql`
    INSERT INTO run_panel (webcam_id, note)
    VALUES (${Number(p.id)}, ${`seeded 2026-09-08: ${p.confirmed_sunsets} confirmed sunsets, lng ${Number(p.lng).toFixed(1)}`})
    ON CONFLICT (webcam_id) DO NOTHING
  `;
}
console.log(`\nwrote ${picked.length} rows to run_panel.`);
console.log('Now enable capture: node scripts/set-runtime-flag.mjs run_panel_capture on --apply');
