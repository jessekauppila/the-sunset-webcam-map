import type { WindyWebcam } from '@/app/lib/types';
import { readSignal } from '../qualitySignal';
import { sunAltitudeDeg } from '../solarPosition';
import type { TileInput } from './types';

/** One camera as frozen by `scripts/export-scene-pool.mjs`. */
export interface FixtureCam {
  webcamId: number;
  latitude: number;
  longitude: number;
  previewWidth: number;
  previewHeight: number;
  aiRatingBinary?: number;
  aiRatingRegression?: number;
  llmQuality?: number | null;
  llmIsSunset?: boolean | null;
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
 * The cast is narrow and deliberate: readSignal reads four optional score
 * fields and nothing else, so a full WindyWebcam would be dead weight in the
 * fixture and one more thing to keep in sync.
 */
export function poolFrom(
  cams: FixtureCam[],
  representsAt: string,
  gateThreshold = 0.55
): TileInput[] {
  const moment = new Date(representsAt);
  return cams.map((c) => {
    const { passes, score } = readSignal(
      c as unknown as WindyWebcam,
      'auto',
      gateThreshold
    );
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
