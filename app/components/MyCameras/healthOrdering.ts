import type { CameraHealth } from '@/app/lib/cameraHealth';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

// Worst first: surface broken cameras at the top of the list.
export const HEALTH_ORDER: Record<CameraHealth, number> = {
  offline: 0,
  stale: 1,
  never: 2,
  live: 3,
};

export function sortByHealthWorstFirst(cams: MyCameraMarker[]): MyCameraMarker[] {
  return [...cams].sort((a, b) => {
    const d = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    return d !== 0 ? d : a.title.localeCompare(b.title);
  });
}

export interface HealthSummary {
  live: number;
  stale: number;
  offline: number;
  never: number;
}

export function summarizeHealth(cams: MyCameraMarker[]): HealthSummary {
  const s: HealthSummary = { live: 0, stale: 0, offline: 0, never: 0 };
  for (const c of cams) s[c.health] += 1;
  return s;
}
