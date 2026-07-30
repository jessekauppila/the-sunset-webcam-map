import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import type { RingCamera } from './ringLogic';

type Webcam = Awaited<ReturnType<typeof fetchTerminatorWebcams>>[number];

function normalize(w: Webcam): RingCamera | null {
  const imageUrl = w.images?.current?.preview;
  if (!imageUrl) return null;
  return {
    id: w.webcamId,
    lng: w.location.longitude,
    title: w.title ? w.title : null,
    imageUrl,
  };
}

export async function getRankedCameras(): Promise<RingCamera[]> {
  const webcams = await fetchTerminatorWebcams();
  return webcams
    .map((w) => ({ ring: normalize(w), rank: w.rank ?? Number.MAX_SAFE_INTEGER }))
    .filter((x): x is { ring: RingCamera; rank: number } => x.ring !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.ring);
}
