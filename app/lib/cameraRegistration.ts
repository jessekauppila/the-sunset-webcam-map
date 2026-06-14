import { randomBytes } from 'node:crypto';
import { sql } from '@/app/lib/db';
import { hashDeviceToken } from '@/app/lib/cameraAuth';

export const PHASE_VALUES = ['sunrise', 'sunset', 'both'] as const;
export type PhasePreference = typeof PHASE_VALUES[number];

export type PlacementStatus = 'awaiting_location' | 'awaiting_aim' | 'ready';

export type PlacementShape = {
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export function derivePlacementStatus(row: PlacementShape): PlacementStatus {
  if (row.lat == null || row.lng == null) return 'awaiting_location';
  if (row.azimuth_deg == null || row.tilt_deg == null) return 'awaiting_aim';
  return 'ready';
}

export function mintDeviceToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('hex');
  return { plaintext, hash: hashDeviceToken(plaintext) };
}

