import { nextBoundaryMs } from '@/app/lib/solo/schedule';
import type { Feed } from '@/app/lib/solo/types';

/** Milliseconds until this screen's next change. Always > 0. */
export function msUntilBoundary(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return Math.max(1, nextBoundaryMs(nowMs, feed, dwellS, offsetS) - nowMs);
}
