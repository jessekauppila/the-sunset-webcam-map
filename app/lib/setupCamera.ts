import { sql } from '@/app/lib/db';

/** The camera fields the HTTPS setup page needs, resolved from a printed claim code. */
export interface SetupCamera {
  cameraId: number;
  lat: number;
  lng: number;
  phase: 'sunrise' | 'sunset';
  azimuthDeg: number | null;
}

type Row = {
  id: number;
  lat: string | number;
  lng: string | number;
  phase_preference: string | null;
  azimuth_deg: string | number | null;
};

export async function getCameraByClaimCode(code: string): Promise<SetupCamera | null> {
  const rows = (await sql`
    SELECT id, lat, lng, phase_preference, azimuth_deg
    FROM cameras
    WHERE claim_code = ${code}
    LIMIT 1
  `) as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    cameraId: r.id,
    lat: Number(r.lat),
    lng: Number(r.lng),
    phase: r.phase_preference === 'sunrise' ? 'sunrise' : 'sunset',
    azimuthDeg: r.azimuth_deg == null ? null : Number(r.azimuth_deg),
  };
}
