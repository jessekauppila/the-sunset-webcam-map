import { isEligible, project } from '@/app/lib/solo/engine';
import { nextBoundaryMs, slotFor } from '@/app/lib/solo/schedule';
import type { ScreenRow, StoredEntry } from '@/app/lib/solo/store';
import type { BinEntry, Feed, SoloDials } from '@/app/lib/solo/types';

/** The response shape both solo endpoints return. Pure: no I/O here. */

export const NEXT_COUNT = 8;

const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Route files may only export handler fields, so the query parser lives here. */
export function parseFeed(raw: string | null): Feed | null {
  return raw && (FEEDS as string[]).includes(raw) ? (raw as Feed) : null;
}

export interface EntryView {
  snapshotId: number;
  webcamId: number;
  bin: BinEntry['bin'];
  quality: number | null;
  detection: number;
  isNew: boolean;
  tally: number;
  enteredAt: number;
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
  eligible: boolean;
  /** 1-based position within its bin by score, queue membership ignored. */
  rank: number;
}

export interface StateView {
  feed: Feed;
  dials: SoloDials;
  current: { entry: EntryView; shownSince: number | null; slot: number | null } | null;
  next: EntryView[];
  bins: { sunset: EntryView[]; nonSunset: EntryView[] };
  schedule: { slot: number; nextBoundaryMs: number };
  lastPull: { admitted: { sunset: number; nonSunset: number } };
}

const scoreOf = (e: StoredEntry) => (e.bin === 'sunset' ? e.quality ?? -1 : e.detection);
const byScore = (a: StoredEntry, b: StoredEntry) => scoreOf(b) - scoreOf(a) || a.enteredAt - b.enteredAt;

function rankMap(entries: StoredEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const bin of ['sunset', 'non_sunset'] as const) {
    entries
      .filter((e) => e.bin === bin)
      .sort(byScore)
      .forEach((e, i) => out.set(e.snapshotId, i + 1));
  }
  return out;
}

export function buildStateView(input: {
  feed: Feed;
  dials: SoloDials;
  entries: StoredEntry[];
  screen: ScreenRow | null;
  nowMs: number;
  admitted: { sunset: number; nonSunset: number };
}): StateView {
  const { feed, dials, entries, screen, nowMs } = input;
  const ranks = rankMap(entries);
  const byId = new Map(entries.map((e) => [e.snapshotId, e]));
  const view = (e: StoredEntry): EntryView => ({
    snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin, quality: e.quality,
    detection: e.detection, isNew: e.isNew, tally: e.tally, enteredAt: e.enteredAt,
    imageUrl: e.imageUrl, title: e.title, city: e.city, region: e.region, country: e.country,
    eligible: isEligible(e, dials), rank: ranks.get(e.snapshotId) ?? 0,
  });

  const currentEntry = screen?.currentSnapshotId != null ? byId.get(screen.currentSnapshotId) ?? null : null;
  const state = {
    lastSnapshotId: currentEntry?.snapshotId ?? null,
    sunsetStreak: screen?.sunsetStreak ?? 0,
  };
  const next = project(entries, dials, state, NEXT_COUNT);
  const queued = new Set([currentEntry?.snapshotId, ...next.map((e) => e.snapshotId)]);
  const remaining = entries.filter((e) => !queued.has(e.snapshotId));

  return {
    feed,
    dials,
    current: currentEntry
      ? { entry: view(currentEntry), shownSince: screen?.shownSince ?? null, slot: screen?.slot ?? null }
      : null,
    next: next.map((e) => view(byId.get(e.snapshotId)!)),
    bins: {
      sunset: remaining.filter((e) => e.bin === 'sunset').sort(byScore).map(view),
      nonSunset: remaining.filter((e) => e.bin === 'non_sunset').sort(byScore).map(view),
    },
    schedule: {
      slot: slotFor(nowMs, feed, dials.dwellS, dials.offsetS),
      nextBoundaryMs: nextBoundaryMs(nowMs, feed, dials.dwellS, dials.offsetS),
    },
    lastPull: { admitted: input.admitted },
  };
}
