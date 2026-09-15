import type { WindyWebcam } from '@/app/lib/types';
import type { SourceCamera } from './types';

/**
 * Dress a SourceCamera as the record the rest of the tick consumes.
 *
 * The register is blunt about this: WindyWebcam is imported by 73 files and
 * the vendor-neutral Webcam type by none, so the cheap way for a second
 * source to reach the Gate, the scorer and the pool is to speak WindyWebcam
 * at the boundary. app/studio/solo/toWebcam.ts does the same for archived
 * bins. This file is that anti-corruption layer, built backwards on purpose;
 * deleting it is the signal the display-side refactor worked.
 *
 * Only what the tick actually reads is populated: location (classification),
 * images.current.preview (the download), source + externalId (the identity),
 * title. Nothing is fabricated for the rest.
 */
export function toWindyShape(cam: SourceCamera): WindyWebcam {
  return {
    webcamId: inTickIdFor(cam),
    title: cam.title,
    viewCount: 0,
    status: 'active',
    images: { current: { preview: cam.imageUrl } },
    location: {
      latitude: cam.lat,
      longitude: cam.lng,
      country: cam.country ?? undefined,
      region: cam.region ?? undefined,
      city: cam.city ?? undefined,
    },
    categories: [],
    lastUpdatedOn: cam.imageAt ?? undefined,
    urls: cam.attribution ? { provider: cam.attribution } : undefined,
    source: cam.source,
    externalId: cam.externalId,
  };
}

/**
 * WindyWebcam.webcamId is a number, and inside a tick a few maps key on it
 * (ring attribution, the sweep's dedupe). Neither applies to a non-Windy
 * camera, and every database and display identity is webcams.id, so this
 * number only has to be stable and non-zero. A numeric external id is used
 * as-is; anything else hashes. Documented decision, not a workaround: the
 * register names the numeric id as the one blocker, and this is where it is
 * absorbed.
 */
export function inTickIdFor(cam: Pick<SourceCamera, 'source' | 'externalId'>): number {
  const n = Number(cam.externalId);
  if (Number.isSafeInteger(n) && n > 0 && String(n) === cam.externalId) return n;
  return fnv1a32(`${cam.source}:${cam.externalId}`) || 1;
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
