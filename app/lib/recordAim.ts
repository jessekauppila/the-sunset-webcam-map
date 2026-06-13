import { sql } from '@/app/lib/db';

export interface AimInput {
  headingDeg: number;
  source: 'phone' | 'manual' | 'window';
  lat?: number;
  lng?: number;
}

export interface AimResult {
  cameraId: number;
  azimuthDeg: number;
}

/**
 * Write a captured aim to the camera row identified by its claim code.
 * MVP: writes the camera directly (the 1:many deployment model is a later evolution).
 * lat/lng are only overwritten when provided (phone GPS); heading is normalized to [0,360).
 */
export async function recordAim(code: string, aim: AimInput): Promise<AimResult | null> {
  const heading = ((Math.round(aim.headingDeg) % 360) + 360) % 360;
  const lat = aim.lat ?? null;
  const lng = aim.lng ?? null;
  const rows = (await sql`
    UPDATE cameras
    SET azimuth_deg = ${heading},
        lat = COALESCE(${lat}, lat),
        lng = COALESCE(${lng}, lng),
        location_source = ${aim.source}
    WHERE claim_code = ${code}
    RETURNING id, azimuth_deg
  `) as { id: number; azimuth_deg: number | string }[];
  const r = rows[0];
  if (!r) return null;
  return { cameraId: r.id, azimuthDeg: Number(r.azimuth_deg) };
}
