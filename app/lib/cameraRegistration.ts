import { randomBytes } from 'node:crypto';
import { sql } from '@/app/lib/db';
import { hashDeviceToken } from '@/app/lib/cameraAuth';

export const PHASE_VALUES = ['sunrise', 'sunset', 'both'] as const;
export type PhasePreference = typeof PHASE_VALUES[number];

export type PlacementStatus = 'pending' | 'ready';

export type PlacementShape = {
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export function derivePlacementStatus(row: PlacementShape): PlacementStatus {
  if (row.lat == null) return 'pending';
  if (row.lng == null) return 'pending';
  if (row.azimuth_deg == null) return 'pending';
  if (row.tilt_deg == null) return 'pending';
  return 'ready';
}

export function mintDeviceToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('hex');
  return { plaintext, hash: hashDeviceToken(plaintext) };
}

export type CameraUpsertInput = {
  lat: number | null;
  lng: number | null;
  elevation_m?: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: PhasePreference;
  delivery_preferences: unknown;
};

export type CameraRow = {
  id: number;
  claim_code: string;
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export async function upsertCameraByClaimCode(
  claimCode: string,
  input: CameraUpsertInput
): Promise<CameraRow> {
  const existing = (await sql`
    SELECT id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
  `) as { id: number }[];

  if (existing[0]) {
    const rows = (await sql`
      UPDATE cameras SET
        lat = ${input.lat},
        lng = ${input.lng},
        elevation_m = ${input.elevation_m ?? null},
        timezone = ${input.timezone},
        azimuth_deg = ${input.azimuth_deg},
        tilt_deg = ${input.tilt_deg},
        horizon_altitude_deg = ${input.horizon_altitude_deg},
        horizon_profile = ${input.horizon_profile == null ? null : JSON.stringify(input.horizon_profile)}::jsonb,
        phase_preference = ${input.phase_preference},
        delivery_preferences = ${input.delivery_preferences == null ? null : JSON.stringify(input.delivery_preferences)}::jsonb
      WHERE id = ${existing[0].id}
      RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
    `) as CameraRow[];
    return rows[0];
  }

  // Pre-register-first: insert a row with placement + sentinel device fields.
  // hardware_id and device_token_hash are filled in by the device's later
  // register call (Task 6). We use sentinel placeholders so the existing
  // NOT NULL constraint holds; register replaces them atomically.
  const sentinelToken = `pending-${claimCode}`;
  const rows = (await sql`
    INSERT INTO cameras (
      hardware_id, device_token_hash, claim_code,
      lat, lng, elevation_m, timezone,
      azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
      phase_preference, delivery_preferences
    )
    VALUES (
      ${sentinelToken}, ${sentinelToken}, ${claimCode},
      ${input.lat}, ${input.lng}, ${input.elevation_m ?? null}, ${input.timezone},
      ${input.azimuth_deg}, ${input.tilt_deg}, ${input.horizon_altitude_deg}, ${input.horizon_profile == null ? null : JSON.stringify(input.horizon_profile)}::jsonb,
      ${input.phase_preference}, ${input.delivery_preferences == null ? null : JSON.stringify(input.delivery_preferences)}::jsonb
    )
    RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
  `) as CameraRow[];
  return rows[0];
}
