import 'server-only';
import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import { getProfileSettings } from '@/app/lib/settings/store';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneProvenance, SceneState } from './types';

const DURABLE_HOSTNAMES = new Set([
  // Real host produced by uploadToFirebase (app/lib/webcamSnapshot.ts):
  // `https://storage.googleapis.com/${bucket.name}/${path}`.
  'storage.googleapis.com',
  // Kept for compatibility with any legacy/alternate Firebase SDK URL shape.
  'firebasestorage.googleapis.com',
]);

export function isDurableFrameUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return DURABLE_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface LiveCaptureResult {
  state: SceneState;
  provenance: SceneProvenance;
  pinned: number;
  pinFailures: number;
}

export async function captureLiveScene(): Promise<LiveCaptureResult> {
  const webcams = await fetchTerminatorWebcams();
  let pinned = 0;
  let pinFailures = 0;

  const frozen: WindyWebcam[] = [];
  for (const cam of webcams) {
    const preview = cam.images?.current?.preview;
    if (isDurableFrameUrl(preview)) {
      frozen.push(cam);
      continue;
    }
    const uploaded = await captureWebcamSnapshot(cam);
    if (uploaded) {
      pinned += 1;
      frozen.push({
        ...cam,
        images: { ...cam.images, current: { ...cam.images?.current, preview: uploaded.url } },
      });
    } else {
      pinFailures += 1;
      frozen.push(cam);
    }
  }

  const state: SceneState = {
    sunrise: frozen.filter((c) => c.phase === 'sunrise'),
    sunset: frozen.filter((c) => c.phase === 'sunset'),
  };

  const profile = await getProfileSettings('live');
  const settings: SceneProvenance['settings'] = profile.namespaces;
  const activeVersion =
    (profile.namespaces.shared?.activeVersion as string | undefined) ?? DEFAULT_MOSAIC_VERSION;

  return { state, provenance: { activeVersion, settings }, pinned, pinFailures };
}
