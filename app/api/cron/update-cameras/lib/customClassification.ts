import { sql } from '@/app/lib/db';
import type { Location, WindyWebcam } from '@/app/lib/types';
import { classifyWebcamsByPhase } from './webcamClassification';

interface CustomCamRow {
  webcam_id: number;
  // Postgres NUMERIC columns come back from the Neon driver as strings.
  // We coerce to number when building the shaped WindyWebcam below so
  // downstream consumers see consistent numeric types.
  lat: number | string;
  lng: number | string;
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
      latitude: Number(r.lat),
      longitude: Number(r.lng),
    },
  }));

  const { sunrise, sunset } = classifyWebcamsByPhase(
    shaped,
    opts.sunriseCoords,
    opts.sunsetCoords,
  );

  return {
    sunrise: sunrise.map((w) => ({ webcamId: w.webcamId as number })),
    sunset: sunset.map((w) => ({ webcamId: w.webcamId as number })),
  };
}
