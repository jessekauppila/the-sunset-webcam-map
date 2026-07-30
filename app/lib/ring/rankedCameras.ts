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
    .map(normalize)
    .filter((c): c is RingCamera => c !== null)
    .sort((a, b) => {
      const ra = rankOf(webcams, a.id);
      const rb = rankOf(webcams, b.id);
      return ra - rb;
    });
}

function rankOf(webcams: Webcam[], id: number): number {
  const w = webcams.find((x) => x.webcamId === id);
  return w ? w.rank : Number.MAX_SAFE_INTEGER;
}
