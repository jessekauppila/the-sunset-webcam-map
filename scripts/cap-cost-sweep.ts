/**
 * Frames/day and storage/day for a range of per-tick caps on the Digitraffic
 * source. Read-only: fetches the live station list, replays one UTC day of
 * terminator geometry at the cron's ten-minute cadence, and applies each cap.
 *
 *   npx --yes tsx scripts/cap-cost-sweep.ts [YYYY-MM-DD]
 *
 * The date defaults to today (UTC). It matters: the terminator band crosses
 * Finland at different latitudes through the year, so the cap that saturates
 * coverage in September is not the one that does in December. The cap is a
 * frequency dial, not a coverage one -- watch where distinct cams/day stops
 * rising (issue #235).
 *
 * Needs no DATABASE_URL: the adapter it imports is kept free of server-only
 * modules, and sourceModulesArePure.test.ts holds that line (issue #245).
 */
import { createTerminatorQueryRing } from '../app/components/Map/lib/terminatorRing';
import { subsolarPoint } from '../app/components/Map/lib/subsolarLocation';
import { withinSweptBoxes } from '../app/api/cron/update-cameras/lib/sources/band';
import { dedupeCoords } from '../app/api/cron/update-cameras/lib/windyApi';
import { parseDigitrafficStations, DIGITRAFFIC_STATIONS_URL, DIGITRAFFIC_USER } from '../app/api/cron/update-cameras/lib/sources/digitraffic';
import { capCamerasPerTick } from '../app/api/cron/update-cameras/lib/sources/capPerTick';
import { SEARCH_RADIUS_DEG, TERMINATOR_PRECISION_DEG, TERMINATOR_SUN_ALTITUDE_DEG, TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '../app/lib/masterConfig';

const res = await fetch(DIGITRAFFIC_STATIONS_URL, { headers: { accept:'application/json','accept-encoding':'gzip','digitraffic-user':DIGITRAFFIC_USER } });
const body = await res.json();
const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`expected YYYY-MM-DD, got ${day}`);
const start = new Date(`${day}T00:00:00Z`);
console.log(`Digitraffic, ${day} UTC, 144 ticks`);

const MEAN_KB = 282;            // measured, 60-preset sample
const REENCODED_KB = 282 * 0.75; // measured q82 saving

console.log('cap   frames/day   distinct cams/day   GB/day raw   GB/day compressed');
for (const cap of [30, 60, 120, 200, 400]) {
  let total = 0; const seen = new Set<string>();
  for (let i = 0; i < 144; i++) {
    const now = new Date(start.getTime() + i * 600000);
    const { raHours, gmstHours } = subsolarPoint(now);
    const coords = [];
    for (const off of [0, ...TERMINATOR_DAY_SIDE_OFFSETS_DEG]) {
      const r = createTerminatorQueryRing(now, raHours, gmstHours, TERMINATOR_PRECISION_DEG, TERMINATOR_SUN_ALTITUDE_DEG, off);
      coords.push(...dedupeCoords(r.sunriseCoords), ...dedupeCoords(r.sunsetCoords));
    }
    const within = withinSweptBoxes(dedupeCoords(coords), SEARCH_RADIUS_DEG);
    const inBand = parseDigitrafficStations(body, { within }).cameras;
    const taken = capCamerasPerTick(inBand, now, cap).cameras;
    total += taken.length;
    for (const c of taken) seen.add(c.externalId);
  }
  const rawGB = total * MEAN_KB / 1024 / 1024;
  const reGB = total * REENCODED_KB / 1024 / 1024;
  console.log(`${String(cap).padStart(3)}   ${String(total).padStart(10)}   ${String(seen.size).padStart(17)}   ${rawGB.toFixed(2).padStart(10)}   ${reGB.toFixed(2).padStart(17)}`);
}
