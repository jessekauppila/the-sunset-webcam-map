import type { WindyWebcam } from './types';
import type { MyCameraMarker } from './myCameras.types';

/**
 * Adapt a custom-camera marker into the WindyWebcam shape so the existing map
 * marker + popup code renders it unchanged. The extra cameraHealth/isInWindowNow
 * fields ride along for the health ring and popup header.
 */
export function myCameraToWindyWebcam(cam: MyCameraMarker): WindyWebcam {
  return {
    webcamId: cam.markerId,
    title: cam.title,
    viewCount: 0,
    status: cam.health,
    images: cam.latestSnapshotUrl
      ? { current: { preview: cam.latestSnapshotUrl } }
      : undefined,
    location: { latitude: cam.lat, longitude: cam.lng },
    categories: [],
    phase: cam.phase === 'both' ? undefined : cam.phase,
    cameraHealth: cam.health,
    isInWindowNow: cam.isInWindowNow,
    lastSnapshotAt: cam.lastSnapshotAt,
    lastHeartbeatAt: cam.lastHeartbeatAt,
  };
}
