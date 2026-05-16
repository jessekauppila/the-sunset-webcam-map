import { sql } from '@/app/lib/db';
import { SEARCH_RADIUS_DEG } from '@/app/lib/masterConfig';
import type { Location, WindyWebcam } from '@/app/lib/types';
import { classifyWebcamsByPhase } from './webcamClassification';

interface CustomCamRow {
  webcam_id: number;
  lat: number;
  lng: number;
}

export interface CustomTerminatorRow {
  webcamId: number;
}

export async function classifyCustomCamerasForTick(opts: {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
  freshnessWindowMinutes: number;
  now: Date;
}): Promise<{
  sunrise: CustomTerminatorRow[];
  sunset: CustomTerminatorRow[];
}> {
  const cutoff = new Date(
    opts.now.getTime() - opts.freshnessWindowMinutes * 60_000,
  );

  const rows = (await sql`
    select w.id as webcam_id, w.lat, w.lng
    from webcams w
    where w.source = 'custom'
      and exists (
        select 1 from webcam_snapshots s
        where s.webcam_id = w.id
          and s.captured_at >= ${cutoff}
      )
  `) as CustomCamRow[];

  if (rows.length === 0) {
    return { sunrise: [], sunset: [] };
  }

  // Shape into the WindyWebcam-ish form classifyWebcamsByPhase consumes.
  // Only `webcamId` and `location.{latitude,longitude}` are read; required
  // fields per the WindyWebcam interface get empty/zero defaults.
  const shaped: WindyWebcam[] = rows.map((r) => ({
    webcamId: r.webcam_id,
    title: '',
    viewCount: 0,
    status: 'unknown',
    categories: [],
    location: {
      latitude: r.lat,
      longitude: r.lng,
    },
  }));

  const { sunrise, sunset } = classifyWebcamsByPhase(
    shaped,
    opts.sunriseCoords,
    opts.sunsetCoords,
  );

  function minDistToCoords(lat: number, lng: number, coords: Location[]): number {
    return Math.min(
      ...coords.map((coord) =>
        Math.sqrt(
          Math.pow(lng - coord.lng, 2) + Math.pow(lat - coord.lat, 2),
        ),
      ),
    );
  }

  const filteredSunrise = sunrise.filter((w) => {
    const row = rows.find((r) => r.webcam_id === (w.webcamId as number));
    if (!row) return false;
    return minDistToCoords(row.lat, row.lng, opts.sunriseCoords) <= SEARCH_RADIUS_DEG;
  });

  const filteredSunset = sunset.filter((w) => {
    const row = rows.find((r) => r.webcam_id === (w.webcamId as number));
    if (!row) return false;
    return minDistToCoords(row.lat, row.lng, opts.sunsetCoords) <= SEARCH_RADIUS_DEG;
  });

  return {
    sunrise: filteredSunrise.map((w) => ({ webcamId: w.webcamId as number })),
    sunset: filteredSunset.map((w) => ({ webcamId: w.webcamId as number })),
  };
}
