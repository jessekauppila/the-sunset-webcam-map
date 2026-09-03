import { readSignal, type SignalSource } from '../qualitySignal';
import { sunAltitudeDeg } from '../solarPosition';
import type { TileInput } from './types';

/**
 * One camera as frozen by `scripts/export-scene-pool.mjs`.
 *
 * The score fields come from WindyWebcam by name, so renaming one there is a
 * compile error here rather than a fixture that silently reads as unscored.
 * The script's `trim()` is the remaining copy of this field list; keep them
 * in step.
 */
export interface FixtureCam extends SignalSource {
  webcamId: number;
  latitude: number;
  longitude: number;
  previewWidth: number;
  previewHeight: number;
}

export interface FixturePool {
  label: string;
  representsAt: string;
  sunrise: FixtureCam[];
  sunset: FixtureCam[];
}

/**
 * Fixture rows to engine inputs, through the REAL signal and solar-position
 * code rather than a second copy of the rules. `useLoadedTiles` does exactly
 * this at runtime; the only thing the fixture stands in for is the image
 * load, whose only contribution is the natural size.
 *
 * No cast: readSignal takes a SignalSource, the Pick of WindyWebcam it
 * actually reads, and FixtureCam extends that Pick.
 */
export function poolFrom(
  cams: FixtureCam[],
  representsAt: string,
  gateThreshold = 0.55
): TileInput[] {
  const moment = new Date(representsAt);
  return cams.map((c) => {
    const { passes, score } = readSignal(c, 'auto', gateThreshold);
    return {
      id: c.webcamId,
      lat: c.latitude,
      lng: c.longitude,
      srcWidth: c.previewWidth,
      srcHeight: c.previewHeight,
      passes,
      score,
      sunAltitudeDeg: sunAltitudeDeg(moment, c.latitude, c.longitude),
    };
  });
}
