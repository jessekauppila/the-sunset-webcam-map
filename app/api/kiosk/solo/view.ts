import { isEligible } from '@/app/lib/solo/engine';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Role } from '@/app/lib/solo2/types';
import { nextBoundaryMs, slotFor } from '@/app/lib/solo/schedule';
import type { ScreenRow, StoredEntry, TapeFrame } from '@/app/lib/solo/store';
import type { BinEntry, Feed, SoloDials } from '@/app/lib/solo/types';
import type { Zone } from '@/app/lib/solo/zone';
import { assignStages, compareStaged, type Stage } from '@/app/lib/solo/stages';

/**
 * The response shape both solo endpoints return. Pure: no I/O here, and no
 * server-only import, so the studio can re-run it in the browser with its
 * own dials.
 */

export const NEXT_COUNT = 8;
/** Past draws on the studio's tape. */
export const TAPE_PAST = 24;

const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Route files may only export handler fields, so the query parser lives here. */
export function parseFeed(raw: string | null): Feed | null {
  return raw && (FEEDS as string[]).includes(raw) ? (raw as Feed) : null;
}

/** What the client needs per frame. No coordinates, no feed: those stay server-side. */
export interface ViewEntry extends BinEntry {
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
  /** When the picture was taken, ms since epoch. */
  capturedAt: number;
  /** IANA zone at the camera, for the local-time caption; null when unknown. */
  timezone: string | null;
  /** Solar altitude at the camera when the picture was taken, degrees; null when unknown. */
  sunAltitudeDeg: number | null;
}

export function toViewEntry(e: StoredEntry): ViewEntry {
  return {
    snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin, quality: e.quality,
    detection: e.detection, isNew: e.isNew, tally: e.tally, enteredAt: e.enteredAt, lastShownAt: e.lastShownAt,
    imageUrl: e.imageUrl, title: e.title, city: e.city, region: e.region, country: e.country,
    capturedAt: e.capturedAt, timezone: e.timezone, sunAltitudeDeg: e.sunAltitudeDeg,
  };
}

export function toTapeInput(f: TapeFrame): ViewEntry & { slot: number; shownAt: number } {
  return { ...toViewEntry(f), slot: f.slot, shownAt: f.shownAt };
}

export interface EntryView extends ViewEntry {
  eligible: boolean;
  /** 1-based position within its bin by score, queue membership ignored. The glass overlay prints it. */
  rank: number;
  /** Where the frame stands for this screen's next draw; the studio sections the bins by it. */
  stage: Stage;
}

/** A past draw on the tape: a full entry (so it opens the detail card) plus when it was drawn. */
export interface TapeEntry extends EntryView {
  slot: number;
  shownAt: number;
}

export interface StateView {
  feed: Feed;
  dials: SoloDials;
  current: {
    entry: EntryView;
    shownSince: number | null;
    slot: number | null;
    /**
     * When this dwell ends, ms since epoch (dwell-budget spec §5.1). An
     * absolute instant, never a remaining duration: a duration is only
     * meaningful with a fetch timestamp attached and goes stale in a cached
     * response, an instant does not.
     *
     * The server owns WHEN a dwell ends because its length is a function of
     * engine state; a client owns only how far along it is. Null when the
     * screen has no shown-since to measure from.
     */
    endsAtMs: number | null;
  } | null;
  next: EntryView[];
  /** Parallel to `next`: what each draw is inside its bar. All peaks for solo. */
  nextRoles: Role[];
  bins: { sunset: EntryView[]; nonSunset: EntryView[] };
  schedule: { slot: number; nextBoundaryMs: number };
  lastPull: { admitted: { sunset: number; nonSunset: number } };
  /** Every active entry, raw, so a client can re-project with other dials. */
  entries: ViewEntry[];
  zone: Zone;
  /** The last draws on this screen, oldest first (stages-and-tape spec §4). Empty until the log is migrated. */
  tape: TapeEntry[];
}

const scoreOf = (e: ViewEntry) => (e.bin === 'sunset' ? e.quality ?? -1 : e.detection);
const byScore = (a: ViewEntry, b: ViewEntry) => scoreOf(b) - scoreOf(a) || a.enteredAt - b.enteredAt;

function rankMap(entries: ViewEntry[]): Map<number, number> {
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
  entries: ViewEntry[];
  screen: ScreenRow | null;
  nowMs: number;
  admitted: { sunset: number; nonSunset: number };
  zone: Zone;
  /** Which engine projects the queue. Defaults to solo, so older callers are unchanged. */
  version?: SoloVersionSpec;
  /** Past draws for the tape; the state route supplies them, other callers may omit. */
  tape?: (ViewEntry & { slot: number; shownAt: number })[];
}): StateView {
  const { feed, dials, entries, screen, nowMs } = input;
  const version = input.version ?? (SOLO_VERSIONS.solo as SoloVersionSpec);
  const ranks = rankMap(entries);
  const byId = new Map(entries.map((e) => [e.snapshotId, e]));
  const currentEntry = screen?.currentSnapshotId != null ? byId.get(screen.currentSnapshotId) ?? null : null;
  const state = {
    lastSnapshotId: currentEntry?.snapshotId ?? null,
    sunsetStreak: screen?.sunsetStreak ?? 0,
  };
  // The next draw happens at the next boundary, whose slot is one past now's.
  const firstSlot = slotFor(nowMs, feed, dials.dwellS, dials.offsetS) + 1;
  // Project past the queue so every eligible frame gets a draw position (stages spec §3.1).
  const eligibleCount = entries.filter((e) => isEligible(e, dials)).length;
  const draws = version.project(entries, dials, state, eligibleCount + NEXT_COUNT, firstSlot, feed);
  const next = draws.slice(0, NEXT_COUNT);
  const stages = assignStages({ entries, dials, state, firstSlot, draws, queueDepth: NEXT_COUNT });
  // The frames a draw plays share its stage (camera-run spec §3.4): a
  // camera's older frames stand where the camera stands, not where the frame
  // rules alone would put them. solo shows the pick alone, so nothing moves.
  const shared = new Set<number>();
  for (const draw of draws) {
    const stage = stages.get(draw.snapshotId);
    if (!stage) continue;
    for (const f of version.shown(entries, draw, dials)) {
      if (f.snapshotId === draw.snapshotId || shared.has(f.snapshotId)) continue;
      shared.add(f.snapshotId);
      stages.set(f.snapshotId, stage);
    }
  }
  if (currentEntry) for (const f of version.shown(entries, currentEntry, dials)) stages.set(f.snapshotId, { kind: 'onGlass' });
  const view = (e: ViewEntry): EntryView => ({
    ...e,
    eligible: isEligible(e, dials),
    rank: ranks.get(e.snapshotId) ?? 0,
    stage: stages.get(e.snapshotId) ?? { kind: 'inLine', position: null },
  });
  const queued = new Set([currentEntry?.snapshotId, ...next.map((e) => e.snapshotId)]);
  const remaining = entries.filter((e) => !queued.has(e.snapshotId));
  const staged = compareStaged(stages, dials);

  return {
    feed,
    dials,
    current: currentEntry
      ? {
        entry: view(currentEntry),
        shownSince: screen?.shownSince ?? null,
        slot: screen?.slot ?? null,
        endsAtMs: screen?.shownSince != null
          ? screen.shownSince + version.dwellMs(entries, currentEntry, dials)
          : null,
      }
      : null,
    next: next.map((e) => view(byId.get(e.snapshotId)!)),
    nextRoles: next.map((_, i) => version.roleAt(firstSlot + i, feed, dials)),
    bins: {
      sunset: remaining.filter((e) => e.bin === 'sunset').sort(staged).map(view),
      nonSunset: remaining.filter((e) => e.bin === 'non_sunset').sort(staged).map(view),
    },
    schedule: {
      slot: slotFor(nowMs, feed, dials.dwellS, dials.offsetS),
      nextBoundaryMs: nextBoundaryMs(nowMs, feed, dials.dwellS, dials.offsetS),
    },
    lastPull: { admitted: input.admitted },
    entries,
    zone: input.zone,
    tape: (input.tape ?? []).map((f) => ({ ...view(f), slot: f.slot, shownAt: f.shownAt })),
  };
}
