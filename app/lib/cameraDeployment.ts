import { sql } from '@/app/lib/db';
import type { PlacementMode } from '@/app/lib/deploymentPlacement';

export type DeploymentState = 'testing' | 'deployed' | 'ended';
export type PlacementStatus = 'awaiting_location' | 'awaiting_aim' | 'ready';

export type DeploymentRow = {
  id: number;
  custom_camera_id: number;
  state: DeploymentState;
  paused: boolean;
  started_at: Date | null;
  ended_at: Date | null;
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
  phase_preference: string | null;
  delivery_preferences: unknown;
};

export async function getActiveDeployment(cameraId: number): Promise<DeploymentRow | null> {
  const rows = (await sql`
    SELECT id, custom_camera_id, state, paused, started_at, ended_at,
           lat, lng, elevation_m, timezone,
           azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
           azimuth_source, coarse, bracket, phase_preference, delivery_preferences
    FROM webcams
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    LIMIT 1
  `) as DeploymentRow[];
  return rows[0] ?? null;
}

export function derivePlacementStatus(
  d: Pick<DeploymentRow, 'lat' | 'lng' | 'azimuth_deg' | 'tilt_deg'> | null
): PlacementStatus {
  if (!d || d.lat == null || d.lng == null) return 'awaiting_location';
  if (d.azimuth_deg == null || d.tilt_deg == null) return 'awaiting_aim';
  return 'ready';
}

export type DeploymentPlacementInput = {
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
  phase_preference: string | null;
  delivery_preferences: unknown;
};

function j(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}

// mode='new' ends the active deployment and opens a fresh one; mode='reaim'
// updates the active in place (state untouched). When none exists, always inserts
// deployment #1. Repoints cameras.webcam_id on every active-row transition.
// external_id must be unique per deployment (UNIQUE(source, external_id)).
export async function upsertActiveDeployment(
  cameraId: number,
  p: DeploymentPlacementInput,
  opts: { state: DeploymentState; mode: PlacementMode }
): Promise<DeploymentRow> {
  const active = await getActiveDeployment(cameraId);

  if (active && opts.mode === 'reaim') {
    const rows = (await sql`
      UPDATE webcams SET
        lat = ${p.lat}, lng = ${p.lng}, elevation_m = ${p.elevation_m},
        timezone = ${p.timezone}, azimuth_deg = ${p.azimuth_deg}, tilt_deg = ${p.tilt_deg},
        horizon_altitude_deg = ${p.horizon_altitude_deg},
        horizon_profile = ${j(p.horizon_profile)}::jsonb,
        azimuth_source = ${p.azimuth_source}, coarse = ${p.coarse}, bracket = ${j(p.bracket)}::jsonb,
        phase_preference = ${p.phase_preference},
        delivery_preferences = ${j(p.delivery_preferences)}::jsonb
      WHERE id = ${active.id}
      RETURNING id, custom_camera_id, state, paused, started_at, ended_at,
                lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
                horizon_altitude_deg, horizon_profile, azimuth_source, coarse,
                bracket, phase_preference, delivery_preferences
    `) as DeploymentRow[];
    return rows[0];
  }

  if (active && opts.mode === 'new') {
    await sql`UPDATE webcams SET ended_at = NOW(), state = 'ended' WHERE id = ${active.id}`;
  }

  // external_id must be unique per deployment (UNIQUE(source, external_id)).
  const externalId = `custom-${cameraId}-${Date.now()}`;
  const inserted = (await sql`
    INSERT INTO webcams (
      source, custom_camera_id, external_id, title, status,
      state, paused, started_at,
      lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
      horizon_altitude_deg, horizon_profile, azimuth_source, coarse, bracket,
      phase_preference, delivery_preferences
    ) VALUES (
      'custom', ${cameraId}, ${externalId}, ${'Camera ' + cameraId}, 'active',
      ${opts.state}, FALSE, NOW(),
      ${p.lat}, ${p.lng}, ${p.elevation_m}, ${p.timezone}, ${p.azimuth_deg}, ${p.tilt_deg},
      ${p.horizon_altitude_deg}, ${j(p.horizon_profile)}::jsonb, ${p.azimuth_source}, ${p.coarse}, ${j(p.bracket)}::jsonb,
      ${p.phase_preference}, ${j(p.delivery_preferences)}::jsonb
    )
    RETURNING id, custom_camera_id, state, paused, started_at, ended_at,
              lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
              horizon_altitude_deg, horizon_profile, azimuth_source, coarse,
              bracket, phase_preference, delivery_preferences
  `) as DeploymentRow[];

  await sql`UPDATE cameras SET webcam_id = ${inserted[0].id} WHERE id = ${cameraId}`;
  return inserted[0];
}

export async function endActiveDeployment(
  cameraId: number,
  opts: { relocate: boolean }
): Promise<{ ended: boolean }> {
  const ended = (await sql`
    UPDATE webcams SET ended_at = NOW(), state = 'ended'
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    RETURNING id
  `) as { id: number }[];
  await sql`
    UPDATE cameras
    SET webcam_id = NULL,
        wifi_wipe_requested = (wifi_wipe_requested OR ${opts.relocate})
    WHERE id = ${cameraId}
  `;
  return { ended: ended.length > 0 };
}

export async function setDeploymentPaused(
  cameraId: number,
  paused: boolean
): Promise<{ id: number; paused: boolean } | null> {
  const rows = (await sql`
    UPDATE webcams SET paused = ${paused}
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    RETURNING id, paused
  `) as { id: number; paused: boolean }[];
  return rows[0] ?? null;
}
