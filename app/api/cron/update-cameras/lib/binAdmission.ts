import 'server-only';
import {
  activeWebcamIds,
  getCalibrationMultipliers,
  insertEntry,
  listActiveEntries,
  markOutOfZone,
  markSeen,
  removeStale,
} from '@/app/lib/solo/store';
import { inFeedZone, type Zone } from '@/app/lib/solo/zone';
import type { BinKind, Feed } from '@/app/lib/solo/types';

/**
 * Solo kiosk admission and maintenance, spec §5.3. Runs inside the cron tick.
 *
 * The cron floors are FIXED and generous. The studio dials only narrow from
 * here, so the cron never chases a dial and a dial change is visible within
 * one poll instead of one cron tick.
 */
export const BIN_ADMIT_DETECTION_FLOOR = 0.2;
const MAX_ENTRY_AGE_HOURS = 24;
const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Detection verdict first, then the probability floor. Null = not for the bins. */
export function decideBin(scored: { binaryIsSunset?: boolean; binaryRawScore?: number }): BinKind | null {
  if (scored.binaryIsSunset === true) return 'sunset';
  if (typeof scored.binaryRawScore === 'number' && scored.binaryRawScore >= BIN_ADMIT_DETECTION_FLOOR) {
    return 'non_sunset';
  }
  return null;
}

export interface Admission {
  feed: Feed;
  bin: BinKind;
  snapshotId: number;
  webcamId: number;
  /** ai_regression_score, uncalibrated. */
  rawQuality: number;
  /** ai_binary_score. */
  detection: number;
}

export async function enterBins(
  admissions: Admission[],
): Promise<{ sunset: number; nonSunset: number; duplicates: number }> {
  const out = { sunset: 0, nonSunset: 0, duplicates: 0 };
  if (admissions.length === 0) return out;
  const multipliers = await getCalibrationMultipliers([...new Set(admissions.map((a) => a.webcamId))]);
  const activeByFeed = new Map<Feed, Set<number>>();
  for (const feed of FEEDS) activeByFeed.set(feed, await activeWebcamIds(feed));

  for (const a of admissions) {
    // Quality is the calibrated tile signal; detection is never calibrated
    // (per-camera-calibration spec). Non-sunset rows carry no quality at all:
    // the quality head is trained on sunsets and its score there is noise.
    const quality = a.bin === 'sunset' ? a.rawQuality * (multipliers.get(a.webcamId) ?? 1) : null;
    const isNew = activeByFeed.get(a.feed)!.has(a.webcamId);
    const inserted = await insertEntry({
      feed: a.feed, bin: a.bin, snapshotId: a.snapshotId, webcamId: a.webcamId,
      quality, detection: a.detection, isNew,
    });
    if (!inserted) { out.duplicates += 1; continue; }
    if (a.bin === 'sunset') out.sunset += 1; else out.nonSunset += 1;
    activeByFeed.get(a.feed)!.add(a.webcamId);
  }
  return out;
}

/**
 * Removal is by zone, not by absence. Every active entry is checked against
 * where its camera's sun is right now; a poll that simply did not return the
 * camera changes nothing.
 */
export async function maintainBins(opts: {
  now: Date;
  zone: Zone;
  grace: number;
}): Promise<{ leftZone: number; expired: number }> {
  const totals = { leftZone: 0, expired: 0 };
  for (const feed of FEEDS) {
    const entries = await listActiveEntries(feed);
    const seen = new Set<number>();
    const out = new Set<number>();
    for (const e of entries) {
      (inFeedZone(opts.now, e.lat, e.lng, feed, opts.zone) ? seen : out).add(e.webcamId);
    }
    await markSeen(feed, [...seen]);
    await markOutOfZone(feed, [...out]);
    const removed = await removeStale(feed, { grace: opts.grace, maxAgeHours: MAX_ENTRY_AGE_HOURS });
    totals.leftZone += removed.leftZone;
    totals.expired += removed.expired;
  }
  return totals;
}
