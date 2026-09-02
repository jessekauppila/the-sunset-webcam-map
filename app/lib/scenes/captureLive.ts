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

// Bound how many pins run at once so a ~30-cam pool at 1-2s each doesn't
// push against the POST route's maxDuration=60s by running fully serially.
const PIN_CONCURRENCY = 5;

/**
 * `provenanceProfile` decides WHICH dial positions the scene records. 'live'
 * is what the glass was running. 'studio' is what the operator was looking
 * at when they hit save, which is the one that matters when the point of the
 * capture is to reference a composition you were mid-way through tuning.
 */
export async function captureLiveScene(
  provenanceProfile: 'studio' | 'live' = 'live'
): Promise<LiveCaptureResult> {
  const webcams = await fetchTerminatorWebcams();
  let pinned = 0;
  let pinFailures = 0;

  // Preallocate by index so pool order survives out-of-order chunk settling.
  const frozen: WindyWebcam[] = new Array(webcams.length);
  const volatileIndices: number[] = [];

  webcams.forEach((cam, index) => {
    const preview = cam.images?.current?.preview;
    if (isDurableFrameUrl(preview)) {
      frozen[index] = cam;
    } else {
      volatileIndices.push(index);
    }
  });

  for (let start = 0; start < volatileIndices.length; start += PIN_CONCURRENCY) {
    const chunkIndices = volatileIndices.slice(start, start + PIN_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunkIndices.map((index) => captureWebcamSnapshot(webcams[index]))
    );
    settled.forEach((outcome, i) => {
      const index = chunkIndices[i];
      const cam = webcams[index];
      if (outcome.status === 'fulfilled' && outcome.value) {
        pinned += 1;
        frozen[index] = {
          ...cam,
          images: { ...cam.images, current: { ...cam.images?.current, preview: outcome.value.url } },
        };
      } else {
        pinFailures += 1;
        frozen[index] = cam;
      }
    });
  }

  const state: SceneState = {
    sunrise: frozen.filter((c) => c.phase === 'sunrise'),
    sunset: frozen.filter((c) => c.phase === 'sunset'),
  };

  const profile = await getProfileSettings(provenanceProfile);
  const settings: SceneProvenance['settings'] = profile.namespaces;
  const activeVersion =
    (profile.namespaces.shared?.activeVersion as string | undefined) ?? DEFAULT_MOSAIC_VERSION;

  return { state, provenance: { activeVersion, settings }, pinned, pinFailures };
}
