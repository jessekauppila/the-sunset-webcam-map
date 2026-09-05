import 'server-only';
import { sql } from '@/app/lib/db';
import type { BinEntry, BinKind, Feed } from './types';

/**
 * Every SQL touch of kiosk_bin_entries and kiosk_screen_state (spec §5).
 * Neon returns NUMERIC/BIGINT as strings; every reader here casts.
 */

export interface StoredEntry extends BinEntry {
  feed: Feed;
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  firstShownAt: number | null;
  lastShownAt: number | null;
}

interface EntryRow {
  snapshot_id: string | number;
  webcam_id: string | number;
  bin: BinKind;
  quality: string | number | null;
  detection: string | number;
  is_new: boolean;
  tally: string | number;
  entered_at: string;
  first_shown_at: string | null;
  last_shown_at: string | null;
  firebase_url: string;
  title: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: string | number;
  lng: string | number;
}

const num = (v: string | number) => Number(v);
const ms = (v: string | null) => (v ? Date.parse(v) : null);

function toEntry(feed: Feed, r: EntryRow): StoredEntry {
  return {
    feed,
    snapshotId: num(r.snapshot_id),
    webcamId: num(r.webcam_id),
    bin: r.bin,
    quality: r.quality == null ? null : num(r.quality),
    detection: num(r.detection),
    isNew: r.is_new,
    tally: num(r.tally),
    enteredAt: Date.parse(r.entered_at),
    firstShownAt: ms(r.first_shown_at),
    lastShownAt: ms(r.last_shown_at),
    imageUrl: r.firebase_url,
    title: r.title ?? '',
    city: r.city ?? '',
    region: r.region ?? '',
    country: r.country ?? '',
    lat: num(r.lat),
    lng: num(r.lng),
  };
}

export async function listActiveEntries(feed: Feed): Promise<StoredEntry[]> {
  const rows = (await sql`
    select e.snapshot_id, e.webcam_id, e.bin, e.quality, e.detection, e.is_new, e.tally,
           e.entered_at, e.first_shown_at, e.last_shown_at,
           s.firebase_url, w.title, w.city, w.region, w.country, w.lat, w.lng
    from kiosk_bin_entries e
    join webcam_snapshots s on s.id = e.snapshot_id
    join webcams w on w.id = e.webcam_id
    where e.feed = ${feed} and e.removed_at is null
    order by e.entered_at asc
  `) as unknown as EntryRow[];
  return rows.map((r) => toEntry(feed, r));
}

export async function activeWebcamIds(feed: Feed): Promise<Set<number>> {
  const rows = (await sql`
    select distinct webcam_id from kiosk_bin_entries
    where feed = ${feed} and removed_at is null
  `) as unknown as { webcam_id: string | number }[];
  return new Set(rows.map((r) => num(r.webcam_id)));
}

export async function getCalibrationMultipliers(webcamIds: number[]): Promise<Map<number, number>> {
  if (webcamIds.length === 0) return new Map();
  const rows = (await sql`
    select id, calibration_multiplier from webcams
    where id = any(${webcamIds}) and calibration_multiplier is not null
  `) as unknown as { id: string | number; calibration_multiplier: string | number }[];
  return new Map(rows.map((r) => [num(r.id), num(r.calibration_multiplier)]));
}

export interface InsertEntryInput {
  feed: Feed;
  bin: BinKind;
  snapshotId: number;
  webcamId: number;
  quality: number | null;
  detection: number;
  isNew: boolean;
}

/** True when a row was inserted; false when (feed, snapshot_id) already existed. */
export async function insertEntry(input: InsertEntryInput): Promise<boolean> {
  const rows = (await sql`
    insert into kiosk_bin_entries (feed, bin, snapshot_id, webcam_id, quality, detection, is_new)
    values (${input.feed}, ${input.bin}, ${input.snapshotId}, ${input.webcamId},
            ${input.quality}, ${input.detection}, ${input.isNew})
    on conflict (feed, snapshot_id) do nothing
    returning id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}

export async function markSeen(feed: Feed, webcamIds: number[]): Promise<void> {
  if (webcamIds.length === 0) return;
  await sql`
    update kiosk_bin_entries
    set last_seen_at = now(), out_of_zone_polls = 0
    where feed = ${feed} and removed_at is null and webcam_id = any(${webcamIds})
  `;
}

export async function markOutOfZone(feed: Feed, webcamIds: number[]): Promise<void> {
  if (webcamIds.length === 0) return;
  await sql`
    update kiosk_bin_entries
    set out_of_zone_polls = out_of_zone_polls + 1
    where feed = ${feed} and removed_at is null and webcam_id = any(${webcamIds})
  `;
}

export async function removeStale(
  feed: Feed,
  opts: { grace: number; maxAgeHours: number },
): Promise<{ leftZone: number; expired: number }> {
  const leftZone = (await sql`
    update kiosk_bin_entries
    set removed_at = now(), removed_reason = 'left_zone'
    where feed = ${feed} and removed_at is null and out_of_zone_polls > ${opts.grace}
    returning id
  `) as unknown as { id: number }[];
  const expired = (await sql`
    update kiosk_bin_entries
    set removed_at = now(), removed_reason = 'expired'
    where feed = ${feed} and removed_at is null
      and entered_at < now() - (${opts.maxAgeHours} * interval '1 hour')
    returning id
  `) as unknown as { id: number }[];
  return { leftZone: leftZone.length, expired: expired.length };
}

export interface ScreenRow {
  feed: Feed;
  currentSnapshotId: number | null;
  shownSince: number | null;
  slot: number | null;
  sunsetStreak: number;
}

export async function getScreenState(feed: Feed): Promise<ScreenRow | null> {
  const rows = (await sql`
    select feed, current_snapshot_id, shown_since, slot, sunset_streak
    from kiosk_screen_state where feed = ${feed}
  `) as unknown as {
    feed: Feed; current_snapshot_id: string | number | null; shown_since: string | null;
    slot: string | number | null; sunset_streak: string | number;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    feed: r.feed,
    currentSnapshotId: r.current_snapshot_id == null ? null : num(r.current_snapshot_id),
    shownSince: ms(r.shown_since),
    slot: r.slot == null ? null : num(r.slot),
    sunsetStreak: num(r.sunset_streak),
  };
}

/**
 * Put `entry` on glass for `slot`. The state write is conditional on the slot
 * being new, which is what makes POST /advance idempotent: a second call for
 * the same slot writes nothing and returns false, and the tally is bumped
 * only after the state write succeeded.
 */
export async function commitAdvance(
  feed: Feed,
  slot: number,
  entry: BinEntry,
  sunsetStreak: number,
): Promise<boolean> {
  const rows = (await sql`
    insert into kiosk_screen_state (feed, current_snapshot_id, shown_since, slot, sunset_streak, updated_at)
    values (${feed}, ${entry.snapshotId}, now(), ${slot}, ${sunsetStreak}, now())
    on conflict (feed) do update
      set current_snapshot_id = excluded.current_snapshot_id,
          shown_since = excluded.shown_since,
          slot = excluded.slot,
          sunset_streak = excluded.sunset_streak,
          updated_at = now()
      where kiosk_screen_state.slot is distinct from excluded.slot
    returning feed
  `) as unknown as { feed: Feed }[];
  if (rows.length === 0) return false;
  await sql`
    update kiosk_bin_entries
    set tally = tally + 1,
        is_new = false,
        first_shown_at = coalesce(first_shown_at, now()),
        last_shown_at = now()
    where feed = ${feed} and snapshot_id = ${entry.snapshotId}
  `;
  return true;
}

export async function countAdmittedSince(
  feed: Feed,
  sinceMs: number,
): Promise<{ sunset: number; nonSunset: number }> {
  const rows = (await sql`
    select bin, count(*) as n from kiosk_bin_entries
    where feed = ${feed} and entered_at >= ${new Date(sinceMs).toISOString()}
    group by bin
  `) as unknown as { bin: BinKind; n: string | number }[];
  const out = { sunset: 0, nonSunset: 0 };
  for (const r of rows) {
    if (r.bin === 'sunset') out.sunset = num(r.n);
    else out.nonSunset = num(r.n);
  }
  return out;
}

export interface BinDigestSummary {
  admittedToday: { sunset: number; nonSunset: number };
  removedToday: number;
  activeNow: Record<Feed, number>;
}

/** Null on any failure, so an unmigrated table degrades the digest to silence. */
export async function getBinDigestSummary(): Promise<BinDigestSummary | null> {
  try {
    const rows = (await sql`
      select
        count(*) filter (where entered_at >= current_date and bin = 'sunset')     as admitted_sunset,
        count(*) filter (where entered_at >= current_date and bin = 'non_sunset') as admitted_non,
        count(*) filter (where removed_at >= current_date)                        as removed,
        count(*) filter (where removed_at is null and feed = 'sunrise')           as active_sunrise,
        count(*) filter (where removed_at is null and feed = 'sunset')            as active_sunset
      from kiosk_bin_entries
    `) as unknown as Record<string, string | number>[];
    const r = rows[0];
    if (!r) return null;
    return {
      admittedToday: { sunset: num(r.admitted_sunset), nonSunset: num(r.admitted_non) },
      removedToday: num(r.removed),
      activeNow: { sunrise: num(r.active_sunrise), sunset: num(r.active_sunset) },
    };
  } catch (error) {
    console.warn('[solo/store] bin digest summary failed:', error);
    return null;
  }
}
