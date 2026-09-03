// scripts/altitude-quality-report.mjs
// Read-only report: where in the sky the good sunsets actually happen, and
// whether captured_at can be trusted as UTC.
//
// This is the measurement behind the two 2026-09-02 specs
// (docs/superpowers/specs/2026-09-02-mosaic-v3-band-paradigm-design.md and
// -terminator-pool-coverage-design.md). Re-run it before acting on either;
// both rest on the claim that quality peaks near 0 to +6 degrees while the
// pool's ring sits at -13.
//
// Run: node scripts/altitude-quality-report.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import SunCalc from 'suncalc';

// Read the pool constants out of masterConfig rather than copying them: node
// cannot import the .ts directly, and a hardcoded copy would drift silently
// the first time the ring moves, which is precisely what Plan B may do.
function constFromMasterConfig(name) {
  const src = readFileSync('app/lib/masterConfig.ts', 'utf8');
  const match = src.match(new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!match) throw new Error(`${name} not found in app/lib/masterConfig.ts`);
  return Number(match[1]);
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sql = neon(loadDatabaseUrl());
const DEG_PER_RAD = 180 / Math.PI;
const GOOD = 0.5; // llm_quality is normalized [0,1]; measured max is 0.88

// AT TIME ZONE 'UTC' is doing real work: captured_at is `timestamp without
// time zone`, so this is where the "these digits are UTC" assumption becomes
// explicit. The offset sweep below is what verifies it.
const rows = await sql`
  SELECT EXTRACT(EPOCH FROM s.captured_at AT TIME ZONE 'UTC') AS epoch,
         w.lat AS lat, w.lng AS lng, s.webcam_id AS cam,
         s.llm_quality AS q, s.llm_is_sunset AS sset
  FROM webcam_snapshots s
  JOIN webcams w ON w.id = s.webcam_id
  WHERE s.llm_quality IS NOT NULL
    AND s.captured_at IS NOT NULL
    AND w.lat IS NOT NULL AND w.lng IS NOT NULL`;

const altAt = (epoch, lat, lng, offsetHours = 0) =>
  SunCalc.getPosition(
    new Date((Number(epoch) + offsetHours * 3600) * 1000),
    Number(lat),
    Number(lng)
  ).altitude * DEG_PER_RAD;

const pts = rows.map((r) => ({
  alt: altAt(r.epoch, r.lat, r.lng),
  q: Number(r.q),
  sset: r.sset,
  cam: r.cam,
}));
console.log(`scored frames with coordinates: ${pts.length}`);

// --- 1. Is captured_at really UTC? -----------------------------------------
// A stored-local-time or DST bug would flatten this curve, because no single
// global offset could fix rows from many zones at once. A sharp peak at 0 is
// the evidence that the naked column type is not hiding a bug.
const confirmed = rows.filter((r) => r.sset);
console.log(`\n-- captured_at offset sweep (${confirmed.length} confirmed sunsets) --`);
console.table(
  Array.from({ length: 17 }, (_, i) => i - 8).map((off) => {
    const alts = confirmed.map((r) => altAt(r.epoch, r.lat, r.lng, off));
    return {
      offsetHours: off,
      pctWithin8DegOfHorizon: +(
        (100 * alts.filter((a) => a >= -8 && a <= 8).length) / alts.length
      ).toFixed(1),
    };
  })
);

// --- 2. Where do the good frames actually sit? -----------------------------
console.log('\n-- hit rate by solar altitude, 2-degree bins --');
const bins = [];
for (let lo = -20; lo < 12; lo += 2) {
  const ps = pts.filter((p) => p.alt >= lo && p.alt < lo + 2);
  if (ps.length < 50) continue;
  bins.push({
    altitude: `${lo} to ${lo + 2}`,
    frames: ps.length,
    pctGood: +((100 * ps.filter((p) => p.q >= GOOD).length) / ps.length).toFixed(1),
    meanQuality: +(ps.reduce((a, b) => a + b.q, 0) / ps.length).toFixed(3),
  });
}
console.table(bins);

// --- 3. What the pool's window can and cannot see --------------------------
const ring = constFromMasterConfig('TERMINATOR_SUN_ALTITUDE_DEG');
const radius = constFromMasterConfig('SEARCH_RADIUS_DEG');
const windowMin = ring - radius;
const windowMax = ring + radius;
const good = pts.filter((p) => p.q >= GOOD);
const inWindow = good.filter((p) => p.alt >= windowMin && p.alt <= windowMax);
const alts = good.map((p) => p.alt).sort((a, b) => a - b);
const pct = (x) => +alts[Math.floor(alts.length * x)].toFixed(1);

console.log(`\n-- coverage of the ${windowMin} to ${windowMax} degree pool window --`);
console.log(`good frames (llm_quality >= ${GOOD}): ${good.length}`);
console.log(`  inside the window: ${((100 * inWindow.length) / good.length).toFixed(1)}%`);
console.log(
  `  altitude percentiles: p10 ${pct(0.1)} | p25 ${pct(0.25)} | ` +
    `median ${pct(0.5)} | p75 ${pct(0.75)} | p90 ${pct(0.9)}`
);

// Concentration guard: the headline claim is about nature, not about a
// handful of prolific cameras, so report the share before anyone leans on it.
const byCam = new Map();
for (const p of good) byCam.set(p.cam, (byCam.get(p.cam) ?? 0) + 1);
const shares = [...byCam.values()].sort((a, b) => b - a);
console.log(
  `  distinct cameras: ${byCam.size} | top camera ` +
    `${((100 * shares[0]) / good.length).toFixed(1)}% | top 10 ` +
    `${((100 * shares.slice(0, 10).reduce((a, b) => a + b, 0)) / good.length).toFixed(1)}%`
);
