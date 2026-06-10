import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { requireOwner } from '@/app/lib/owner';
import {
  computeCameraHealth,
  getMostRecentExpectedWindow,
  isInWindowNow,
  type PhasePreference,
} from '@/app/lib/cameraHealth';
import {
  MY_CAMERA_MARKER_ID_OFFSET,
  type MyCameraMarker,
} from '@/app/lib/myCameras.types';

export const dynamic = 'force-dynamic';

type Row = {
  camera_id: number;
  webcam_id: number | null;
  lat: number | string;
  lng: number | string;
  phase_preference: string | null;
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

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const rows = (await sql`
      select c.id               as camera_id,
             c.webcam_id        as webcam_id,
             c.lat              as lat,
             c.lng              as lng,
             c.phase_preference as phase_preference,
             c.last_heartbeat_at as last_heartbeat_at,
             coalesce(w.title, c.hardware_id) as title,
             ls.firebase_url    as latest_snapshot_url,
             ls.captured_at     as latest_snapshot_captured_at
      from cameras c
      left join webcams w on w.id = c.webcam_id
      left join lateral (
        select firebase_url, captured_at
        from webcam_snapshots
        where webcam_id = c.webcam_id
        order by captured_at desc
        limit 1
      ) ls on true
      where c.status = 'active'
      order by c.id
    `) as Row[];

    const now = new Date();

    const cameras: MyCameraMarker[] = rows.map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const phase = toPhase(row.phase_preference);
      const lastSnapshotAt = toDate(row.latest_snapshot_captured_at);
      const lastHeartbeatAt = toDate(row.last_heartbeat_at);
      const window = getMostRecentExpectedWindow({ lat, lng }, phase, now);
      const health = computeCameraHealth({
        lastSnapshotAt,
        lastHeartbeatAt,
        mostRecentWindow: window,
        now,
      });

      return {
        markerId: row.webcam_id ?? MY_CAMERA_MARKER_ID_OFFSET + row.camera_id,
        cameraId: row.camera_id,
        webcamId: row.webcam_id,
        title: row.title ?? `camera-${row.camera_id}`,
        lat,
        lng,
        health,
        isInWindowNow: isInWindowNow(window, now),
        lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
        lastSnapshotAt: lastSnapshotAt ? lastSnapshotAt.toISOString() : null,
        latestSnapshotUrl: row.latest_snapshot_url,
        phase,
      };
    });

    return NextResponse.json(cameras);
  } catch (error) {
    console.error('Error in my-cameras route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
