/**
 * How long the Digitraffic HEAD pass actually takes, and whether its ETags
 * change on our 10-minute cadence. Read-only: HEADs only, no image bodies.
 */
import {
  parseDigitrafficStations, withImageVersions,
  DIGITRAFFIC_STATIONS_URL, DIGITRAFFIC_USER, DIGITRAFFIC_HEAD_CONCURRENCY,
} from '../app/api/cron/update-cameras/lib/sources/digitraffic';

const res = await fetch(DIGITRAFFIC_STATIONS_URL, {
  headers: { accept: 'application/json', 'accept-encoding': 'gzip', 'digitraffic-user': DIGITRAFFIC_USER },
});
const all = parseDigitrafficStations(await res.json(), { within: () => true }).cameras;
const sample = all.slice(0, 120);

const t0 = Date.now();
const first = await withImageVersions(sample, fetch, DIGITRAFFIC_HEAD_CONCURRENCY);
const elapsed = Date.now() - t0;
const versioned = first.cameras.filter((c) => c.imageVersion).length;
console.log(`HEADs: ${sample.length} at concurrency ${DIGITRAFFIC_HEAD_CONCURRENCY} in ${elapsed} ms`);
console.log(`  = ${(elapsed / sample.length).toFixed(1)} ms/HEAD amortized`);
console.log(`  versioned (ETag or Last-Modified): ${versioned}/${sample.length}, headFailed ${first.headFailed}`);
console.log(`  -> full catalogue of ${all.length} presets would take ~${((elapsed / sample.length) * all.length / 1000).toFixed(1)} s`);

const withAt = first.cameras.filter((c) => c.imageAt);
if (withAt.length) {
  const ages = withAt.map((c) => (Date.now() - Date.parse(c.imageAt!)) / 1000);
  ages.sort((a, b) => a - b);
  console.log(`\nframe age at HEAD time (s): min ${ages[0].toFixed(0)}, median ${ages[Math.floor(ages.length/2)].toFixed(0)}, max ${ages[ages.length-1].toFixed(0)}`);
}
