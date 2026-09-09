import 'server-only';
import tzLookup from 'tz-lookup';
import { sql } from '@/app/lib/db';
import type { BinEntry, BinKind, Feed } from './types';
import type { SoloVersionName } from './versions';
import { sunAltitudeDeg } from './zone';

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
  /** When the picture was taken, ms since epoch (UTC). */
  capturedAt: number;
  /** IANA zone at the camera, from its coordinates; null when unresolvable. */
  timezone: string | null;
  /** Solar altitude at the camera when the picture was taken, degrees. */
  sunAltitudeDeg: number | null;
  firstShownAt: number | null;
  lastShownAt: number | null;
  /** Which draw it was last shown on — rest's currency (spec §6.1). */
  lastShownSlot: number | null;
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
  /** `captured_at::text`: a naive UTC timestamp, see parseUtcText. */
  captured_at: string;
  first_shown_at: string | null;
  last_shown_at: string | null;
  last_shown_slot: string | number | null;
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

/**
 * `webcam_snapshots.captured_at` is `timestamp without time zone` holding
 * UTC. The Neon driver parses a naive timestamp as CLIENT-local, which is
 * right on Vercel (UTC) and seven hours off on a Mac, so the query selects
 * `::text` and this parses it as UTC explicitly (solo2 spec §4.5).
 */
export function parseUtcText(text: string): number {
  const t = text.trim().replace(' ', 'T');
  return Date.parse(/(Z|[+-]\d\d(:?\d\d)?)$/.test(t) ? t : `${t}Z`);
}

function zoneOf(lat: number, lng: number): string | null {
  try {
    return Number.isFinite(lat) && Number.isFinite(lng) ? tzLookup(lat, lng) : null;
  } catch {
    return null;
  }
}

function toEntry(feed: Feed, r: EntryRow): StoredEntry {
  const lat = num(r.lat);
  const lng = num(r.lng);
  const capturedAt = parseUtcText(r.captured_at);
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
    lastShownSlot: r.last_shown_slot == null ? null : num(r.last_shown_slot),
    imageUrl: r.firebase_url,
    title: r.title ?? '',
    city: r.city ?? '',
    region: r.region ?? '',
    country: r.country ?? '',
    lat,
    lng,
    capturedAt,
    timezone: zoneOf(lat, lng),
    sunAltitudeDeg: Number.isFinite(capturedAt) && Number.isFinite(lat) && Number.isFinite(lng)
      ? sunAltitudeDeg(new Date(capturedAt), lat, lng) : null,
  };
}

export async function listActiveEntries(feed: Feed): Promise<StoredEntry[]> {
  const rows = (await sql`
    select e.snapshot_id, e.webcam_id, e.bin, e.quality, e.detection, e.is_new, e.tally,
           e.entered_at, e.first_shown_at, e.last_shown_at, e.last_shown_slot,
           s.firebase_url, s.captured_at::text as captured_at, w.title, w.city, w.region, w.country, w.lat, w.lng
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

export interface SweptZone {
  minDeg: number;
  maxDeg: number;
}

/**
 * Record the zone maintainBins just aged entries against, so the state and
 * advance routes can show the same band instead of recomputing a guess from
 * the flag alone. Escalation rings fire per tick, and only the cron knows
 * which ones did. Non-fatal: an unmigrated table must not cost the tick its
 * bins.
 */
export async function saveSweptZone(zone: SweptZone): Promise<void> {
  try {
    await sql`
      insert into kiosk_sweep_zone (id, min_deg, max_deg, updated_at)
      values (1, ${zone.minDeg}, ${zone.maxDeg}, now())
      on conflict (id) do update
        set min_deg = excluded.min_deg, max_deg = excluded.max_deg, updated_at = now()
    `;
  } catch (error) {
    console.warn('[solo/store] swept zone persist failed:', error);
  }
}

/** Null when the cron has not recorded a zone yet, or the table is missing. */
export async function getSweptZone(): Promise<SweptZone | null> {
  try {
    const rows = (await sql`
      select min_deg, max_deg from kiosk_sweep_zone where id = 1
    `) as unknown as { min_deg: string | number; max_deg: string | number }[];
    const r = rows[0];
    if (!r) return null;
    return { minDeg: num(r.min_deg), maxDeg: num(r.max_deg) };
  } catch (error) {
    console.warn('[solo/store] swept zone read failed:', error);
    return null;
  }
}

export interface ScreenRow {
  feed: Feed;
  currentSnapshotId: number | null;
  shownSince: number | null;
  slot: number | null;
  sunsetStreak: number;
  /**
   * How long this dwell occupies the glass, ms, as the engine decided it at
   * the draw. Null for rows written before the dwell migration.
   *
   * Stored rather than recomputed because a dwell's length is a function of
   * the pool AT THE DRAW, and the pool moves every minute. Recomputing it on
   * each fetch let the published end drift while the frame was still up.
   */
  dwellMs?: number | null;
  /**
   * The frames this dwell plays, in play order, the drawn frame last: the
   * same array the draw log stamps, kept on the screen row so the glass reads
   * fact rather than re-deriving a run from a pool that has since changed.
   *
   * Optional alongside `dwellMs` for the same reason: a row from before the
   * migration has neither, and every reader falls back to the old recompute.
   */
  shownSnapshotIds?: number[] | null;
}

export async function getScreenState(feed: Feed): Promise<ScreenRow | null> {
  const rows = (await sql`
    select feed, current_snapshot_id, shown_since, slot, sunset_streak, dwell_ms, shown_snapshot_ids
    from kiosk_screen_state where feed = ${feed}
  `) as unknown as {
    feed: Feed; current_snapshot_id: string | number | null; shown_since: string | null;
    slot: string | number | null; sunset_streak: string | number;
    dwell_ms: string | number | null; shown_snapshot_ids: (string | number)[] | null;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    feed: r.feed,
    currentSnapshotId: r.current_snapshot_id == null ? null : num(r.current_snapshot_id),
    shownSince: ms(r.shown_since),
    slot: r.slot == null ? null : num(r.slot),
    sunsetStreak: num(r.sunset_streak),
    dwellMs: r.dwell_ms == null ? null : num(r.dwell_ms),
    shownSnapshotIds: r.shown_snapshot_ids == null ? null : r.shown_snapshot_ids.map(num),
  };
}

/**
 * Put `entry` on glass for `slot`. The state write is conditional on the slot
 * being new, which is what makes POST /advance idempotent: a second call for
 * the same slot writes nothing and returns false, and the tally is bumped
 * only after the state write succeeded.
 */
/**
 * Move the screen to `entry` for `slot`, once per slot, and mark `shown`
 * (the frames the dwell plays; `entry` alone for solo) as on glass.
 *
 * `dwellMs` is how long the engine says this dwell lasts. It is written into
 * the same row, in the same statement, as the instant the dwell starts, so
 * the pair can never be assembled from two different moments — which is what
 * happened while the end was recomputed on each fetch from a pool that had
 * moved on. The frames are stored beside it for the same reason.
 */
export async function commitAdvance(
  feed: Feed,
  slot: number,
  entry: BinEntry,
  sunsetStreak: number,
  shown: BinEntry[] = [entry],
  version: SoloVersionName = 'solo',
  dwellMs: number | null = null,
): Promise<boolean> {
  const shownIds = shown.map((e) => e.snapshotId);
  const rows = (await sql`
    insert into kiosk_screen_state (feed, current_snapshot_id, shown_since, slot, sunset_streak, dwell_ms, shown_snapshot_ids, updated_at)
    values (${feed}, ${entry.snapshotId}, now(), ${slot}, ${sunsetStreak},
            ${dwellMs == null ? null : Math.round(dwellMs)}, ${shownIds}::bigint[], now())
    on conflict (feed) do update
      set current_snapshot_id = excluded.current_snapshot_id,
          shown_since = excluded.shown_since,
          slot = excluded.slot,
          sunset_streak = excluded.sunset_streak,
          dwell_ms = excluded.dwell_ms,
          shown_snapshot_ids = excluded.shown_snapshot_ids,
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
        last_shown_at = now(),
        -- The SAME counter that logDraw writes to kiosk_draws.slot, below and
        -- in this one operation (spec §6.1.1). Two counters that agree is the
        -- failure that would not announce itself.
        last_shown_slot = ${slot}
    where feed = ${feed} and snapshot_id = any(${shownIds}::bigint[])
  `;
  await logDraw(feed, slot, entry, version, shown);
  return true;
}

/**
 * One past draw on the studio's tape (stages-and-tape spec §4): the whole
 * entry, so a click opens the same detail and rating card as a queue row,
 * plus when it was drawn. Bin rows are only ever marked removed, never
 * deleted, so the join holds after a camera leaves the zone.
 */
export interface TapeFrame extends StoredEntry {
  slot: number;
  /** ms since epoch. */
  shownAt: number;
}

/**
 * Record a draw for the tape, stamped with what drew it (replay spec §2):
 * the version, the newest deploy (the live profile only changes on Deploy,
 * so that is the profile in force), the entry as the engine saw it, and
 * every frame the dwell played. Best-effort: an unmigrated table or column
 * must not stop the glass advancing. Idempotent on (feed, slot), like the
 * state write.
 */
export async function logDraw(
  feed: Feed, slot: number, entry: BinEntry, version: SoloVersionName, shown: BinEntry[],
): Promise<void> {
  try {
    await sql`
      insert into kiosk_draws (feed, slot, snapshot_id, shown_at, version, deploy_id, bin, quality, detection, shown_snapshot_ids)
      select ${feed}, ${slot}, ${entry.snapshotId}, now(), ${version}, (select max(id) from kiosk_deploys),
             ${entry.bin}, ${entry.quality}, ${entry.detection}, ${shown.map((e) => e.snapshotId)}::bigint[]
      on conflict (feed, slot) do nothing
    `;
  } catch (error) {
    console.warn('[solo/store] draw log failed:', error);
  }
}

/** The last `n` draws for a screen, oldest first. Empty when the table is missing. */
export async function listRecentDraws(feed: Feed, n: number): Promise<TapeFrame[]> {
  try {
    const rows = (await sql`
      select d.slot, d.shown_at,
             e.snapshot_id, e.webcam_id, e.bin, e.quality, e.detection, e.is_new, e.tally,
             e.entered_at, e.first_shown_at, e.last_shown_at, e.last_shown_slot,
             s.firebase_url, s.captured_at::text as captured_at, w.title, w.city, w.region, w.country, w.lat, w.lng
      from kiosk_draws d
      join kiosk_bin_entries e on e.feed = d.feed and e.snapshot_id = d.snapshot_id
      join webcam_snapshots s on s.id = d.snapshot_id
      join webcams w on w.id = e.webcam_id
      where d.feed = ${feed}
      order by d.slot desc
      limit ${n}
    `) as unknown as (EntryRow & { slot: string | number; shown_at: string })[];
    return rows.reverse().map((r) => ({ ...toEntry(feed, r), slot: num(r.slot), shownAt: Date.parse(r.shown_at) }));
  } catch (error) {
    console.warn('[solo/store] draw log read failed:', error);
    return [];
  }
}

/** A logged draw with its stamp, for the replay (spec §3). Unstamped rows read as "unknown". */
export interface DrawRecord extends TapeFrame {
  version: SoloVersionName | null;
  deployId: number | null;
  /** Every frame the dwell played; the drawn frame alone when the row predates the stamp. */
  shownSnapshotIds: number[];
}

/** A bin row as the replay needs it: the entry plus when it left the bin, if it has. */
export interface ReplayEntry extends StoredEntry {
  /** ms since epoch; null while the row is still in the bin. */
  removedAt: number | null;
}

type DrawRow = EntryRow & {
  slot: string | number; shown_at: string; version: string | null; deploy_id: string | number | null;
  shown_snapshot_ids: (string | number)[] | null;
};

/**
 * The draws on one screen between two moments, oldest first. Bin and scores
 * come from the stamp when present, else from the bin-entry join; the
 * webcam comes from the snapshot so a draw older than the bin history still
 * resolves. Empty when the table is missing.
 */
export async function listDrawsBetween(feed: Feed, fromMs: number, toMs: number): Promise<DrawRecord[]> {
  try {
    const rows = (await sql`
      select d.slot, d.shown_at, d.snapshot_id, d.version, d.deploy_id, d.shown_snapshot_ids,
             coalesce(e.webcam_id, s.webcam_id) as webcam_id,
             coalesce(d.bin, e.bin) as bin, coalesce(d.quality, e.quality) as quality, coalesce(d.detection, e.detection) as detection,
             coalesce(e.is_new, false) as is_new, coalesce(e.tally, 0) as tally,
             coalesce(e.entered_at, d.shown_at) as entered_at, e.first_shown_at, e.last_shown_at,
             coalesce(e.last_shown_slot, d.slot) as last_shown_slot,
             s.firebase_url, s.captured_at::text as captured_at, w.title, w.city, w.region, w.country, w.lat, w.lng
      from kiosk_draws d
      left join kiosk_bin_entries e on e.feed = d.feed and e.snapshot_id = d.snapshot_id
      join webcam_snapshots s on s.id = d.snapshot_id
      join webcams w on w.id = coalesce(e.webcam_id, s.webcam_id)
      where d.feed = ${feed} and d.shown_at >= ${new Date(fromMs).toISOString()} and d.shown_at <= ${new Date(toMs).toISOString()}
      order by d.slot asc
    `) as unknown as DrawRow[];
    return rows.map((r) => ({
      ...toEntry(feed, r),
      slot: num(r.slot),
      shownAt: Date.parse(r.shown_at),
      version: r.version === 'solo' || r.version === 'solo2' ? r.version : null,
      deployId: r.deploy_id == null ? null : num(r.deploy_id),
      shownSnapshotIds: r.shown_snapshot_ids?.length ? r.shown_snapshot_ids.map(num) : [num(r.snapshot_id)],
    }));
  } catch (error) {
    console.warn('[solo/store] draw window read failed:', error);
    return [];
  }
}

/**
 * Every bin row that was in the bin at any moment between `fromMs` and
 * `toMs`, removed or not. Scores are the admission-time values the row
 * holds, which is what the engine saw. Shown state on the row is today's
 * and is rebuilt by the replay from the draw log.
 */
export async function listEntriesOverlapping(feed: Feed, fromMs: number, toMs: number): Promise<ReplayEntry[]> {
  const rows = (await sql`
    select e.snapshot_id, e.webcam_id, e.bin, e.quality, e.detection, e.is_new, e.tally,
           e.entered_at, e.first_shown_at, e.last_shown_at, e.last_shown_slot, e.removed_at,
           s.firebase_url, s.captured_at::text as captured_at, w.title, w.city, w.region, w.country, w.lat, w.lng
    from kiosk_bin_entries e
    join webcam_snapshots s on s.id = e.snapshot_id
    join webcams w on w.id = e.webcam_id
    where e.feed = ${feed} and e.entered_at <= ${new Date(toMs).toISOString()}
      and (e.removed_at is null or e.removed_at >= ${new Date(fromMs).toISOString()})
    order by e.entered_at asc
  `) as unknown as (EntryRow & { removed_at: string | null })[];
  return rows.map((r) => ({ ...toEntry(feed, r), removedAt: ms(r.removed_at) }));
}

/** Drop draws older than `olderThanDays`. Best-effort; the cron calls it every tick. */
export async function pruneDraws(olderThanDays: number): Promise<void> {
  try {
    await sql`
      delete from kiosk_draws where shown_at < now() - make_interval(days => ${olderThanDays})
    `;
  } catch (error) {
    console.warn('[solo/store] draw log prune failed:', error);
  }
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
