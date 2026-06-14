import { sql } from '@/app/lib/db';
import {
  computeCameraHealth,
  getMostRecentExpectedWindow,
  isInWindowNow,
  type CameraHealth,
  type PhasePreference,
} from '@/app/lib/cameraHealth';

export interface CameraDetail {
  cameraId: number;
  webcamId: number | null;
  title: string;
  hardwareId: string;
  deviceClass: string;
  firmwareVersion: string | null;
  lat: number;
  lng: number;
  phase: PhasePreference;
  status: string;
  registeredAt: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  latestSnapshotUrl: string | null;
  health: CameraHealth;
  isInWindowNow: boolean;
}

type Row = {
  camera_id: number;
  webcam_id: number | null;
  hardware_id: string;
  device_class: string;
  firmware_version: string | null;
  lat: number | string;
  lng: number | string;
  phase_preference: string | null;
  status: string;
  registered_at: string | Date | null;
  last_heartbeat_at: string | Date | null;
  title: string | null;
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: string | Date | null;
};

function toPhase(value: string | null): PhasePreference {
  return value === 'sunrise' || value === 'sunset' ? value : 'both';
}

function toDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(v: string | Date | null): string | null {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

/**
 * Full metadata + window-relative health for a single custom camera, by
 * cameras.id. Reuses A's cameraHealth logic. Returns null when no such camera.
 */
export async function fetchCameraDetail(
  cameraId: number
): Promise<CameraDetail | null> {
  const rows = (await sql`
    select c.id                as camera_id,
           w.id                as webcam_id,
           c.hardware_id       as hardware_id,
           c.device_class      as device_class,
           c.firmware_version  as firmware_version,
           w.lat               as lat,
           w.lng               as lng,
           w.phase_preference  as phase_preference,
           c.status            as status,
           c.registered_at     as registered_at,
           c.last_heartbeat_at as last_heartbeat_at,
           coalesce(w.title, c.hardware_id) as title,
           ls.firebase_url     as latest_snapshot_url,
           ls.captured_at      as latest_snapshot_captured_at
    from cameras c
    left join webcams w on w.custom_camera_id = c.id
                       and w.source = 'custom'
                       and w.ended_at is null
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = w.id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.id = ${cameraId}
    limit 1
  `) as Row[];

  if (rows.length === 0) return null;
  const row = rows[0];

  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const phase = toPhase(row.phase_preference);
  const lastSnapshotAt = toDate(row.latest_snapshot_captured_at);
  const lastHeartbeatAt = toDate(row.last_heartbeat_at);
  const now = new Date();
  const window = getMostRecentExpectedWindow({ lat, lng }, phase, now);
  const health = computeCameraHealth({
    lastSnapshotAt,
    lastHeartbeatAt,
    mostRecentWindow: window,
    now,
  });

  return {
    cameraId: row.camera_id,
    webcamId: row.webcam_id,
    title: row.title ?? row.hardware_id,
    hardwareId: row.hardware_id,
    deviceClass: row.device_class,
    firmwareVersion: row.firmware_version,
    lat,
    lng,
    phase,
    status: row.status,
    registeredAt: toIso(row.registered_at),
    lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
    lastSnapshotAt: lastSnapshotAt ? lastSnapshotAt.toISOString() : null,
    latestSnapshotUrl: row.latest_snapshot_url,
    health,
    isInWindowNow: isInWindowNow(window, now),
  };
}
