// Windy quota gate check. Read-only. Run from the repo root:
//   node scripts/windy-gate-check.mjs
//
// Four reads, one verdict line. HOLD on any 429/403 from Windy, a non-OK
// probe, or land boxes coming back empty (the 200-with-empty-body shape a
// quota could take). CLEAN only once today has crossed the figure.
//
// Rebuilt 2026-09-03 from the session scratchpad copy that ran the first
// post-crossing read (27,600 boxes, zero non-OK, all land boxes populated).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

// The projected volume of a 2-minute cron cadence in the camera-refresh cost
// spec. Never a measured limit; the first full day over it (2026-09-03) was
// clean. Kept as the line the gate reads against until a real one is found.
const CROSSING = 22300;

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n\\r]+)"?', 'm')) || [])[1];
const dbUrl = get('DATABASE_URL');
const token = get('NEXT_PUBLIC_WINDY_ACCESS_TOKEN');
if (!dbUrl || !token) {
  console.error('need DATABASE_URL and NEXT_PUBLIC_WINDY_ACCESS_TOKEN in .env.local');
  process.exit(1);
}
const now = new Date();
const hdr = (t) => console.log('\n=== ' + t + ' ===');
const verdict = [];

// 1. DB totals: did today cross the figure? And is the force flag on?
hdr('1. Box totals (daily_sunset_stats, UTC today)');
let total = null;
try {
  const sql = neon(dbUrl);
  const r = (await sql`select sweep_ticks, sweep_base_boxes, sweep_escalation_boxes, sweep_escalated_ticks,
      sweep_sunrise_thin_ticks, sweep_sunset_thin_ticks from daily_sunset_stats where date = current_date`)[0];
  if (!r) throw new Error('no row for today');
  total = Number(r.sweep_base_boxes) + Number(r.sweep_escalation_boxes);
  console.log(`ticks=${r.sweep_ticks} base=${r.sweep_base_boxes} esc=${r.sweep_escalation_boxes} ` +
    `escalated_ticks=${r.sweep_escalated_ticks} sunrise_thin=${r.sweep_sunrise_thin_ticks} sunset_thin=${r.sweep_sunset_thin_ticks}`);
  console.log(`TOTAL ${total} vs ${CROSSING}: ${total >= CROSSING ? 'CROSSED' : 'NOT CROSSED, short by ' + (CROSSING - total)}`);
  const flag = (await sql`select enabled, updated_at from runtime_flags where key = 'sweep_force_day_ring'`)[0];
  console.log(`sweep_force_day_ring = ${flag?.enabled} (updated ${flag?.updated_at})`);
  verdict.push(total >= CROSSING ? 'crossed' : 'NOT crossed');
  if (flag?.enabled) verdict.push('note: force flag is ON');
} catch (e) { console.log('DB read failed:', e.message.slice(0, 160)); verdict.push('DB read FAILED'); }

// 2. Status codes (error-bearing sweeps only; a quota shows as 429/403)
hdr('2. Non-OK Windy status codes (vercel logs, --since 5h, error-bearing sweeps)');
try {
  const out = execSync('vercel logs --environment production --no-branch --since 5h --limit 500 --query "API error" --json 2>/dev/null', { encoding: 'utf8', maxBuffer: 64 << 20 });
  const seen = new Set(); const codes = {}; let sweeps = 0;
  for (const l of out.trim().split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (seen.has(r.id)) continue; seen.add(r.id); sweeps++;
    for (const g of r.logs || []) { const m = g.message.match(/API error for [-0-9.,]+: (\d+)/); if (m) codes[m[1]] = (codes[m[1]] || 0) + 1; }
  }
  console.log(`error-bearing sweeps=${sweeps} codes=${JSON.stringify(codes)}`);
  const bad = Object.keys(codes).filter((c) => c === '429' || c === '403');
  verdict.push(bad.length ? `HOLD: saw ${bad.join('/')}` : (Object.keys(codes).length ? 'only ' + Object.keys(codes).join('/') + ' (not quota)' : 'no non-OK at all'));
} catch (e) { console.log('vercel logs failed:', e.message.slice(0, 160)); verdict.push('log read FAILED'); }

// 3. Unbiased sample: are sweeps running, and the true non-OK rate
hdr('3. Unbiased recent sample (vercel logs, --since 1h, no query)');
try {
  const out = execSync('vercel logs --environment production --no-branch --since 1h --limit 500 --json 2>/dev/null', { encoding: 'utf8', maxBuffer: 64 << 20 });
  const seen = new Set(); let sweeps = 0, att = 0, err = 0, found = 0, tmin = null, tmax = null;
  for (const l of out.trim().split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (seen.has(r.id)) continue; seen.add(r.id);
    let a = 0, e = 0, f = 0;
    for (const g of r.logs || []) { if (/Fetching webcams/.test(g.message)) a++; if (/API error for/.test(g.message)) e++; const m = g.message.match(/Found (\d+) webcams/); if (m) f += Number(m[1]); }
    if (!a) continue; sweeps++; att += a; err += e; found += f;
    const t = new Date(r.timestamp); tmin = !tmin || t < tmin ? t : tmin; tmax = !tmax || t > tmax ? t : tmax;
  }
  console.log(`sweeps=${sweeps} boxes=${att} nonOK=${err} rate=${att ? (100 * err / att).toFixed(2) : 'n/a'}% camerasFound=${found} window=${tmin?.toISOString().slice(11, 19)}Z..${tmax?.toISOString().slice(11, 19)}Z`);
  if (!sweeps) verdict.push('WARNING: no sweeps in the last hour');
  else if (att && found === 0) verdict.push('HOLD: sweeps running but finding zero cameras');
} catch (e) { console.log('vercel logs failed:', e.message.slice(0, 160)); }

// 4. Live land-box probe: a quota returning 200-empty shows as land boxes at zero
hdr('4. Live land-box probe (6 calls)');
const R = 11;
const spots = [['alps-land', 46.5, 10.0], ['centraleu-land', 48.0, 11.0], ['usne-land', 42.0, -73.0], ['japan-land', 36.0, 138.0], ['pacific-ocean', 0.0, -140.0], ['southocean', -55.0, -90.0]];
let landZero = 0, landOk = 0; const nonOk = [];
for (const [name, lat, lng] of spots) {
  const b = { northLat: Math.min(90, lat + R), southLat: Math.max(-90, lat - R), eastLon: Math.min(180, lng + R), westLon: Math.max(-180, lng - R) };
  const url = `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${b.northLat}&southLat=${b.southLat}&eastLon=${b.eastLon}&westLon=${b.westLon}&zoom=4&include=images&include=urls&include=player&include=location&include=categories`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'x-windy-api-key': token } });
    let n = 'n/a';
    if (res.ok) { const d = await res.json(); n = Array.isArray(d) ? d.length : '?'; if (name.endsWith('land')) { if (n === 0) landZero++; else landOk++; } }
    else nonOk.push(res.status);
    console.log(`${name.padEnd(16)} ${res.status} cams=${n}`);
  } catch (e) { console.log(`${name.padEnd(16)} THREW ${e.message}`); }
  await new Promise((r) => setTimeout(r, 400));
}
if (nonOk.length) verdict.push(`HOLD: probe got ${nonOk.join('/')}`);
else if (landZero && !landOk) verdict.push('HOLD: all land boxes empty (200-empty quota shape)');
else verdict.push(`probe clean (${landOk} land boxes populated)`);

hdr('VERDICT ' + now.toISOString());
console.log(verdict.join(' | '));
const hold = verdict.some((v) => v.startsWith('HOLD') || v.includes('FAILED'));
console.log(hold ? '>>> HOLD THE FLIP' : (total !== null && total >= CROSSING ? '>>> CLEAN, first full day over the figure' : '>>> CLEAN SO FAR, but not yet crossed: re-check later'));
