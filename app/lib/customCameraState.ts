import { sql } from '@/app/lib/db';

/**
 * Live operational state for a single custom camera. Combines the cameras-row
 * metadata (immutable per-device fields) with the latest webcam_snapshots row
 * (most-recent capture, may be null for brand-new cameras).
 *
 * Shared by the public terminator-payload (popup image source) and the future
 * admin / fleet status view (per-row state). Both consumers want the same
 * atomic facts about a custom camera.
 */
export interface CustomCameraLiveState {
  device_class: string;
  firmware_version: string | null;
  hardware_id: string;
  latest_snapshot: {
    firebase_url: string;
    captured_at: Date;
  } | null;
}

type SingleRow = {
  device_class: string;
  firmware_version: string | null;
  hardware_id: string;
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: Date | null;
};

type BatchRow = SingleRow & { webcam_id: number };

function rowToState(row: SingleRow): CustomCameraLiveState {
  return {
    device_class: row.device_class,
    firmware_version: row.firmware_version,
    hardware_id: row.hardware_id,
    latest_snapshot:
      row.latest_snapshot_url && row.latest_snapshot_captured_at
        ? {
            firebase_url: row.latest_snapshot_url,
            captured_at: row.latest_snapshot_captured_at,
          }
        : null,
  };
}

/**
 * Fetch the live state for a single custom camera by cameras.id.
 * Returns null when no camera with that id exists.
 */
export async function getCustomCameraLiveState(
  cameraId: number
): Promise<CustomCameraLiveState | null> {
  const rows = (await sql`
    select c.device_class,
           c.firmware_version,
           c.hardware_id,
           ls.firebase_url   as latest_snapshot_url,
           ls.captured_at    as latest_snapshot_captured_at
    from cameras c
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = c.webcam_id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.id = ${cameraId}
    limit 1
  `) as SingleRow[];

  if (rows.length === 0) return null;
  return rowToState(rows[0]);
}

/**
 * Fetch the live state for many custom cameras at once, keyed by webcam_id
 * (not camera_id) because the most common consumer — the terminator-payload
 * call site — joins through webcams. Returns a Map; webcam_ids with no
 * matching custom camera are absent from the result.
 */
export async function getCustomCameraLiveStatesByWebcamId(
  webcamIds: number[]
): Promise<Map<number, CustomCameraLiveState>> {
  const out = new Map<number, CustomCameraLiveState>();
  if (webcamIds.length === 0) return out;

  const rows = (await sql`
    select c.webcam_id,
           c.device_class,
           c.firmware_version,
           c.hardware_id,
           ls.firebase_url   as latest_snapshot_url,
           ls.captured_at    as latest_snapshot_captured_at
    from cameras c
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = c.webcam_id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.webcam_id = any(${webcamIds})
  `) as BatchRow[];

  for (const row of rows) {
    out.set(row.webcam_id, rowToState(row));
  }
  return out;
}
