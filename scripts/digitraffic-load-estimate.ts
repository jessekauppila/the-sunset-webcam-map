/**
 * What turning source_digitraffic on would cost, measured rather than guessed.
 *
 * Replays a full UTC day of the real sweep geometry (144 ticks at the
 * 10-minute cron cadence, base ring + the forced day-side ring that has been
 * ON since 2026-09-08) against the live Digitraffic station list, and counts
 * the presets that land inside the swept band each tick. That count is the
 * per-tick HEAD volume; the presets whose frame changed are the per-tick
 * fetch-and-score-and-store volume.
 *
 *   npx --yes tsx scripts/digitraffic-load-estimate.ts
 *
 * Read-only: one GET to Digitraffic, no database, no writes.
 */
import { createTerminatorQueryRing } from '../app/components/Map/lib/terminatorRing';
import { subsolarPoint } from '../app/components/Map/lib/subsolarLocation';
import { withinSweptBoxes } from '../app/api/cron/update-cameras/lib/sources/band';
import { dedupeCoords } from '../app/api/cron/update-cameras/lib/windyApi';
import {
  parseDigitrafficStations,
  DIGITRAFFIC_STATIONS_URL,
  DIGITRAFFIC_USER,
} from '../app/api/cron/update-cameras/lib/sources/digitraffic';
import { capCamerasPerTick, SOURCE_MAX_CAMERAS_PER_TICK } from '../app/api/cron/update-cameras/lib/sources/capPerTick';
import {
  SEARCH_RADIUS_DEG,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_DAY_SIDE_OFFSETS_DEG,
} from '../app/lib/masterConfig';

const TICKS_PER_DAY = 144;
const TICK_MS = 10 * 60 * 1000;

const res = await fetch(DIGITRAFFIC_STATIONS_URL, {
  headers: { accept: 'application/json', 'accept-encoding': 'gzip', 'digitraffic-user': DIGITRAFFIC_USER },
});
console.log(`stations GET: ${res.status} ${res.statusText}`);
if (!res.ok) process.exit(1);
const body = await res.json();

// The whole catalogue, with the band test disabled, to size the source.
const all = parseDigitrafficStations(body, { within: () => true });
console.log(`catalogue: ${all.stations} stations -> ${all.cameras.length} presets in collection`);
console.log(`skipped:   ${JSON.stringify(all.skipped)}`);
const lats = all.cameras.map((c) => c.lat);
console.log(`latitude:  ${Math.min(...lats).toFixed(2)} .. ${Math.max(...lats).toFixed(2)} N\n`);

const start = new Date(Date.UTC(2026, 8, 16, 0, 0, 0));
const perTick: number[] = [];
const everSeen = new Set<string>();

for (let i = 0; i < TICKS_PER_DAY; i++) {
  const now = new Date(start.getTime() + i * TICK_MS);
  const { raHours, gmstHours } = subsolarPoint(now);
  const coords = [];
  for (const offsetDeg of [0, ...TERMINATOR_DAY_SIDE_OFFSETS_DEG]) {
    const r = createTerminatorQueryRing(
      now, raHours, gmstHours, TERMINATOR_PRECISION_DEG, TERMINATOR_SUN_ALTITUDE_DEG, offsetDeg,
    );
    coords.push(...dedupeCoords(r.sunriseCoords), ...dedupeCoords(r.sunsetCoords));
  }
  const within = withinSweptBoxes(dedupeCoords(coords), SEARCH_RADIUS_DEG);
  const inBand = parseDigitrafficStations(body, { within }).cameras;
  const taken = capCamerasPerTick(inBand, now).cameras;
  for (const c of taken) everSeen.add(c.externalId);
  perTick.push(taken.length);
}

const total = perTick.reduce((a, b) => a + b, 0);
const nonZero = perTick.filter((n) => n > 0);
const sorted = [...perTick].sort((a, b) => a - b);
console.log(`ticks with any in-band preset: ${nonZero.length} / ${TICKS_PER_DAY}`);
console.log(`in-band presets per tick: max ${Math.max(...perTick)}, median ${sorted[72]}, mean ${(total / TICKS_PER_DAY).toFixed(1)}`);
console.log(`HEADs per day (sum of per-tick taken, cap ${SOURCE_MAX_CAMERAS_PER_TICK}): ${total}`);
console.log(`distinct presets that enter the band in a day: ${everSeen.size}`);
console.log(`\nper-tick series (00:00Z onward, 10-min steps):`);
for (let h = 0; h < 24; h++) {
  console.log(`  ${String(h).padStart(2, '0')}Z  ${perTick.slice(h * 6, h * 6 + 6).map((n) => String(n).padStart(4)).join(' ')}`);
}
