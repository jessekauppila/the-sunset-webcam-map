import 'server-only';
import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import { getProfileSettings } from '@/app/lib/settings/store';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneProvenance, SceneState } from './types';
import { archiveSceneFrame } from './archive';

const DURABLE_HOSTNAMES = new Set([
  // Real host produced by uploadToFirebase (app/lib/webcamSnapshot.ts):
  // `https://storage.googleapis.com/${bucket.name}/${path}`.
  'storage.googleapis.com',
  // Kept for compatibility with any legacy/alternate Firebase SDK URL shape.
  'firebasestorage.googleapis.com',
]);

/**
 * The storage path inside a durable frame URL, which uploadToFirebase builds
 * as `https://storage.googleapis.com/<bucket>/<path>`. Needed because an
 * already-durable frame still has to be FILED at capture time — the scene
 * records that this frame was in the pool at this moment, which is a
 * different fact from when the device first uploaded it. Without that row a
 * pointer scene silently loses every custom camera whose last upload fell
 * outside the window.
 */
export function firebasePathFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.replace(/^\//, '').split('/');
    return segments.slice(1).join('/');
  } catch {
    return '';
  }
}

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
  /** Frames filed into webcam_snapshots, so the scene can be a pointer. */
  archived: number;
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
  const toArchive: Array<{ cam: WindyWebcam; frame: { url: string; path: string } }> = [];

  webcams.forEach((cam, index) => {
    const preview = cam.images?.current?.preview;
    if (isDurableFrameUrl(preview)) {
      frozen[index] = cam;
      // Already on our storage, so nothing to upload — but it still needs a
      // row at THIS moment for the window to find it.
      toArchive.push({ cam, frame: { url: preview!, path: firebasePathFromUrl(preview!) } });
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
        toArchive.push({ cam, frame: outcome.value });
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

  // File the pool into the archive. This is the whole point of an operator
  // capture: every OTHER way a frame is archived is model-gated (the heads
  // disagree, or the incumbent scored it highly) plus a 2% random trickle,
  // so the archive drifts toward what the current model already understands.
  // A full ungated pool is the strongest correction to that drift available,
  // and it is what lets a scene be a pointer instead of a private copy.
  //
  // EVERY frame in the pool is filed, pinned or already durable. A row here
  // means "this frame was in the pool at this instant", which is what the
  // window query looks for; skipping the durable ones would drop every
  // custom camera whose last upload fell outside the window.
  let archived = 0;
  for (const { cam, frame } of toArchive) {
    const phase = cam.phase === 'sunrise' ? 'sunrise' : 'sunset';
    if (await archiveSceneFrame(cam, frame, phase)) archived += 1;
  }

  const profile = await getProfileSettings(provenanceProfile);
  const settings: SceneProvenance['settings'] = profile.namespaces;
  const activeVersion =
    (profile.namespaces.shared?.activeVersion as string | undefined) ?? DEFAULT_MOSAIC_VERSION;

  return { state, provenance: { activeVersion, settings }, pinned, pinFailures, archived };
}
