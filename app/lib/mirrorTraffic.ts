import type { Feed } from '@/app/lib/solo/types';
import { getMirrorCallBuckets, incrMirrorCallBucket } from '@/app/lib/cache';
import { MIRROR_CALLS_PER_VIEWER_HOUR, MIRROR_COUNT_SAMPLE_RATE } from '@/app/lib/masterConfig';

/**
 * The mirror tripwire (#238): how many calls /api/mirror/state answered, per
 * feed per UTC hour, so the daily digest can say when the uncached mirror
 * stops being cheap.
 *
 * The route is uncached on purpose — the glass follows the same URL, and an
 * edge cache would let the two screens go stale independently (#252) — so
 * its cost is proportional to its viewers. This is how anyone finds out that
 * a link has travelled further than a handful of people.
 */

const FEEDS: readonly Feed[] = ['sunset', 'sunrise'];
const HOURS = 24;
const HOUR_MS = 3_600_000;

export function mirrorBucketKey(feed: Feed, at: Date): string {
  return `mirror:calls:${feed}:${at.toISOString().slice(0, 13)}`;
}

/**
 * Count one answered call, 1 in 10 of them (MIRROR_COUNT_SAMPLE_RATE). Never
 * throws: the route defers this past its response with after(), and nothing
 * about counting may reach a screen.
 */
export async function countMirrorCall(
  feed: Feed,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<void> {
  if (random() >= MIRROR_COUNT_SAMPLE_RATE) return;
  try {
    await incrMirrorCallBucket(mirrorBucketKey(feed, now));
  } catch (error) {
    console.warn('[mirrorTraffic] count failed:', error);
  }
}

export interface MirrorFeedTraffic {
  /** Calls in the last 24 hours, scaled back up from the sample. */
  calls: number;
  /** Calls in the busiest of those hours, scaled. */
  peakHourCalls: number;
  /** That hour as "HH:00" UTC; null when the feed saw no counted call. */
  peakHourUtc: string | null;
  /** peakHourCalls as followers: an order of magnitude, not a census. */
  viewersAtPeak: number;
}

export type MirrorTraffic = Record<Feed, MirrorFeedTraffic>;

/**
 * The 24 hours ending in the current one, for both feeds, in one read. Null
 * when the counts cannot be read, so the digest drops the line rather than
 * reporting zero.
 */
export async function getMirrorTraffic(now: Date = new Date()): Promise<MirrorTraffic | null> {
  const hours = Array.from({ length: HOURS }, (_, i) => new Date(now.getTime() - (HOURS - 1 - i) * HOUR_MS));
  const values = await getMirrorCallBuckets(FEEDS.flatMap((feed) => hours.map((h) => mirrorBucketKey(feed, h))));
  if (!values) return null;

  const scale = 1 / MIRROR_COUNT_SAMPLE_RATE;
  const traffic = {} as MirrorTraffic;
  FEEDS.forEach((feed, f) => {
    let calls = 0;
    let peakHourCalls = 0;
    let peakHourUtc: string | null = null;
    hours.forEach((hour, i) => {
      const n = Number(values[f * HOURS + i] ?? 0) * scale;
      calls += n;
      if (n > peakHourCalls) {
        peakHourCalls = n;
        peakHourUtc = `${hour.toISOString().slice(11, 13)}:00`;
      }
    });
    traffic[feed] = {
      calls: Math.round(calls),
      peakHourCalls: Math.round(peakHourCalls),
      peakHourUtc,
      viewersAtPeak: Math.round(peakHourCalls / MIRROR_CALLS_PER_VIEWER_HOUR),
    };
  });
  return traffic;
}
