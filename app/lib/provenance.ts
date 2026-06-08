import { V4_TRAINING_CUTOFF } from './masterConfig';

export type Provenance = 'flickr' | 'archive_trained' | 'archive_new';

/**
 * Where a queued frame came from, for the operator badge:
 *  - flickr           → external_images
 *  - archive_new      → webcam frame captured AFTER v4 training (untrained)
 *  - archive_trained  → webcam frame from the v4 training era (approx; see cutoff)
 */
export function deriveProvenance(
  source: string,
  capturedAt: string | null,
): Provenance {
  if (source === 'flickr') return 'flickr';
  if (capturedAt && new Date(capturedAt) > new Date(V4_TRAINING_CUTOFF)) {
    return 'archive_new';
  }
  return 'archive_trained';
}
