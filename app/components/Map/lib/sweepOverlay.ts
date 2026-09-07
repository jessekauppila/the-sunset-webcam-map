import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import type { Location } from '@/app/lib/types';
import {
  SEARCH_RADIUS_DEG,
  TERMINATOR_POOL_COVERAGE_DEG,
  TERMINATOR_PRECISION_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '@/app/lib/masterConfig';
import { boundingBox } from '@/app/lib/sweepBox';
import { subsolarPoint } from './subsolarLocation';
import { createTerminatorRing, terminatorPolygon } from './terminatorRing';

/**
 * The sweep, drawn: which rings the cron can query and whether each one ran
 * on the last tick.
 *
 * The base ring always sweeps. The escalation rings in
 * TERMINATOR_WIDEN_OFFSETS_DEG run only when a feed is thin (or the day ring
 * is forced), so their line is faint until the cron's recorded zone says
 * they swept. The zone is the only live signal the cron leaves behind
 * (kiosk_sweep_zone, rewritten every tick), and it encodes the rings by
 * arithmetic: a zone wider than the base ring's coverage means an
 * escalation ring ran.
 */
export interface SweepRing {
  offsetDeg: number;
  /** Solar altitude the ring sits at: base altitude plus the offset. */
  altitudeDeg: number;
  /** Did the last recorded tick sweep this ring? Base is always true. */
  swept: boolean;
}

export interface SweptZone {
  minDeg: number;
  maxDeg: number;
}

/** Half a degree of slack: the zone is NUMERIC(6,2) and rings are quarter-degree. */
const ZONE_EPS = 0.01;

/**
 * Every ring in config, flagged by whether the recorded zone shows it swept.
 * A null zone (cron never recorded one, table missing) marks only the base
 * ring as swept, which is what the sweep guarantees anyway.
 */
export function sweepRings(zone: SweptZone | null): SweepRing[] {
  const base: SweepRing = { offsetDeg: 0, altitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG, swept: true };
  const escalations = TERMINATOR_WIDEN_OFFSETS_DEG.map((offsetDeg): SweepRing => {
    const altitudeDeg = TERMINATOR_SUN_ALTITUDE_DEG + offsetDeg;
    const swept =
      zone !== null &&
      (offsetDeg > 0
        ? zone.maxDeg > TERMINATOR_POOL_COVERAGE_DEG.max + ZONE_EPS
        : zone.minDeg < TERMINATOR_POOL_COVERAGE_DEG.min - ZONE_EPS);
    return { offsetDeg, altitudeDeg, swept };
  });
  return [base, ...escalations];
}

/**
 * The points the cron queries Windy at for one ring: the ring at the cron's
 * precision, sunrise and sunset halves joined, duplicates at the seam
 * dropped. Same construction as the cron's sweep.
 */
export function ringQueryPoints(time: Date, offsetDeg: number): Location[] {
  const { raHours, gmstHours } = subsolarPoint(time);
  const ring = createTerminatorRing(
    time, raHours, gmstHours, TERMINATOR_PRECISION_DEG, TERMINATOR_SUN_ALTITUDE_DEG, offsetDeg,
  );
  const byKey = new Map<string, Location>();
  for (const point of [...ring.sunriseCoords, ...ring.sunsetCoords]) {
    const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
    if (!byKey.has(key)) byKey.set(key, point);
  }
  return [...byKey.values()];
}

export interface RingProps {
  offsetDeg: number;
  altitudeDeg: number;
  swept: boolean;
}

export interface SweepOverlay {
  lines: FeatureCollection<LineString, RingProps>;
  boxes: FeatureCollection<Polygon, RingProps>;
}

/** Fine enough that the ring reads as a circle on the globe; 2 deg like the base line. */
const LINE_PRECISION_DEG = 2;

/**
 * GeoJSON for the rings asked for: one line per ring, and if `showBoxes`,
 * one lat/lng rectangle per query point. Boxes are drawn as four-corner
 * polygons on purpose: Mapbox's globe projects Mercator geometry, so a
 * straight edge is a parallel or a meridian, which is exactly the box Windy
 * receives.
 */
export function sweepOverlayFeatures(
  time: Date,
  rings: SweepRing[],
  showBoxes: boolean,
): SweepOverlay {
  const lines: Feature<LineString, RingProps>[] = [];
  const boxes: Feature<Polygon, RingProps>[] = [];
  for (const ring of rings) {
    const props: RingProps = { offsetDeg: ring.offsetDeg, altitudeDeg: ring.altitudeDeg, swept: ring.swept };
    const polygon = terminatorPolygon(time, LINE_PRECISION_DEG, TERMINATOR_SUN_ALTITUDE_DEG, ring.offsetDeg);
    lines.push({
      type: 'Feature',
      properties: props,
      geometry: { type: 'LineString', coordinates: polygon.coordinates[0] },
    });
    if (!showBoxes) continue;
    for (const point of ringQueryPoints(time, ring.offsetDeg)) {
      const b = boundingBox(point, SEARCH_RADIUS_DEG);
      boxes.push({
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [b.westLon, b.southLat], [b.eastLon, b.southLat],
            [b.eastLon, b.northLat], [b.westLon, b.northLat],
            [b.westLon, b.southLat],
          ]],
        },
      });
    }
  }
  return {
    lines: { type: 'FeatureCollection', features: lines },
    boxes: { type: 'FeatureCollection', features: boxes },
  };
}
