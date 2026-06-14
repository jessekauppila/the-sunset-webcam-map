import type { CameraHealth, PhasePreference } from './cameraHealth';

export interface MyCameraMarker {
  markerId: number;       // unique key for the marker map (webcamId or offset+cameraId)
  cameraId: number;
  webcamId: number | null;
  title: string;
  lat: number;
  lng: number;
  health: CameraHealth;
  isInWindowNow: boolean;
  lastHeartbeatAt: string | null; // ISO
  lastSnapshotAt: string | null;  // ISO
  latestSnapshotUrl: string | null;
  phase: PhasePreference;
  state: string | null;           // deployment state (e.g. 'active', 'ended')
  ended_at: string | null;        // ISO — null for active deployments
}

// Custom cameras without a webcams row still need a unique, non-colliding marker
// key. Real webcam ids are far below this offset.
export const MY_CAMERA_MARKER_ID_OFFSET = 1_000_000_000;
