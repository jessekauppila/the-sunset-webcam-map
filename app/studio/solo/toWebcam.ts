import type { WindyWebcam } from '@/app/lib/types';
import type { Feed } from '@/app/lib/solo/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';

/**
 * The label card speaks WindyWebcam. A bin entry IS an archived frame, so
 * `frameId` is set and the card writes a gold label against that exact row
 * without a capture step. Detection is carried in the 1–5 form the card's
 * AI readout expects (1 + p × 4, the cron's own mapping).
 */
export function toWebcam(e: EntryView, feed: Feed): WindyWebcam {
  return {
    webcamId: e.webcamId,
    title: e.title,
    viewCount: 0,
    status: 'active',
    images: { current: { preview: e.imageUrl } },
    location: { city: e.city, region: e.region, country: e.country, latitude: 0, longitude: 0 },
    categories: [],
    phase: feed,
    frameId: e.snapshotId,
    aiRatingRegression: e.quality == null ? undefined : 1 + e.quality * 4,
    aiRatingBinary: 1 + e.detection * 4,
  };
}
