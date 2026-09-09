import { describe, it, expect } from 'vitest';
import { buildStateView, parseFeed, toViewEntry, type ViewEntry } from './view';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), ratingFloor: 3.2 }; // quality 0.55: a 0.1 sunset is below it
const ZONE = { minDeg: -24, maxDeg: -2 };
const stored = (id: number, bin: 'sunset' | 'non_sunset', score: number, tally = 0): ViewEntry => ({
  snapshotId: id, webcamId: 100 + id, bin,
  quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '',
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});

describe('parseFeed', () => {
  it('accepts the two feeds and nothing else', () => {
    expect(parseFeed('sunrise')).toBe('sunrise');
    expect(parseFeed('sunset')).toBe('sunset');
    expect(parseFeed('noon')).toBeNull();
    expect(parseFeed(null)).toBeNull();
  });
});

describe('toViewEntry', () => {
  it('drops coordinates and feed, keeps identity, scores, and place', () => {
    const v = toViewEntry({
      ...stored(1, 'sunset', 0.9), feed: 'sunset', lat: 1, lng: 2, firstShownAt: null, lastShownAt: null,
      capturedAt: 5, timezone: 'Europe/Lisbon', sunAltitudeDeg: -1.5,
    });
    expect(v).not.toHaveProperty('lat');
    expect(v).not.toHaveProperty('feed');
    expect(v).toMatchObject({ snapshotId: 1, quality: 0.9, title: 't1' });
  });
});

describe('buildStateView: the published dwell end', () => {
  const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8)];
  const build = (screen: Parameters<typeof buildStateView>[0]['screen']) =>
    buildStateView({ feed: 'sunset', dials: D, entries, screen, nowMs: 1_000_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });

  it('is an absolute instant, shownSince plus the version dwell (spec §5.1)', () => {
    const shownSince = 1_700_000_000_000;
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0 });
    expect(v.current?.endsAtMs).toBe(shownSince + D.dwellS * 1000);
  });

  it('is null when there is no shownSince to measure from', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince: null, slot: 9, sunsetStreak: 0 });
    expect(v.current?.endsAtMs).toBeNull();
  });

  it('is an instant, not a remaining duration: it does not move with nowMs', () => {
    // A duration would go stale in a cached response; an instant does not.
    const shownSince = 1_700_000_000_000;
    const screen = { feed: 'sunset' as const, currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0 };
    const early = buildStateView({ feed: 'sunset', dials: D, entries, screen, nowMs: shownSince + 1000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    const late = buildStateView({ feed: 'sunset', dials: D, entries, screen, nowMs: shownSince + 19_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(early.current?.endsAtMs).toBe(late.current?.endsAtMs);
  });

  it('follows the dwell dial', () => {
    const shownSince = 1_700_000_000_000;
    const v = buildStateView({
      feed: 'sunset', dials: { ...D, dwellS: 47 }, entries,
      screen: { feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0 },
      nowMs: 1_000_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE,
    });
    expect(v.current?.endsAtMs).toBe(shownSince + 47_000);
  });
});

describe('buildStateView', () => {
  it('queued frames are absent from the bins; every entry carries a stage', () => {
    const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8), stored(3, 'non_sunset', 0.5), stored(4, 'sunset', 0.1)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(v.current).toBeNull();
    // Three eligible frames project eight draws: the cycle repeats, which is
    // exactly what the glass will do, so the queue shows it.
    expect(v.next.map((e) => e.snapshotId)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect(v.next[0].stage).toEqual({ kind: 'queued', position: 1 });
    expect(v.bins.sunset.map((e) => e.snapshotId)).toEqual([4]);
    expect(v.bins.sunset[0].eligible).toBe(false);
    expect(v.bins.sunset[0].stage).toEqual({ kind: 'underFloor', floor: expect.closeTo(0.55, 5) });
  });
  it('bins are ordered by stage: in line by draw position, then resting, then under floor', () => {
    // Twelve never-shown sunsets: 8 queue, the rest are in line at draws 9+. Frame 20 is on glass, frame 30 under floor.
    const many = Array.from({ length: 12 }, (_, i) => stored(i + 1, 'sunset', 0.9 - i * 0.01));
    const onGlass = { ...stored(20, 'sunset', 0.95, 1), lastShownAt: 70_000 }; // on glass since slot 3 (dwell 20, offset 10)
    const low = stored(30, 'sunset', 0.1);
    const v = buildStateView({ feed: 'sunset', dials: D, entries: [low, onGlass, ...many],
      screen: { feed: 'sunset', currentSnapshotId: 20, shownSince: 70_000, slot: 3, sunsetStreak: 1 },
      nowMs: 75_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    const kinds = v.bins.sunset.map((e) => e.stage.kind);
    expect(kinds.slice(0, 4)).toEqual(['inLine', 'inLine', 'inLine', 'inLine']);
    expect(v.bins.sunset.slice(0, 4).map((e) => (e.stage as { position: number | null }).position)).toEqual([9, 10, 11, 12]);
    expect(kinds[kinds.length - 1]).toBe('underFloor');
    expect(v.current?.entry.stage).toEqual({ kind: 'onGlass' });
  });
  it('passes the draw log through as tape, oldest first, and defaults to empty', () => {
    const entries = [stored(1, 'sunset', 0.9)];
    const tape = [
      { ...stored(5, 'sunset', 0.7), slot: 1, shownAt: 20_000 },
      { ...stored(6, 'sunset', 0.1), slot: 2, shownAt: 40_000 },
    ];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, tape });
    expect(v.tape.map((f) => f.snapshotId)).toEqual([5, 6]);
    // A tape frame is a full EntryView, so a click opens the detail card; one that left the bins has no live stage.
    expect(v.tape[0]).toMatchObject({ slot: 1, shownAt: 20_000, eligible: true, stage: { kind: 'inLine', position: null } });
    expect(v.tape[1].eligible).toBe(false);
    const bare = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(bare.tape).toEqual([]);
  });
  it('current comes from the screen row and is excluded from next', () => {
    const entries = [stored(1, 'sunset', 0.9, 1), stored(2, 'sunset', 0.8)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries,
      screen: { feed: 'sunset', currentSnapshotId: 1, shownSince: 5, slot: 3, sunsetStreak: 1 },
      nowMs: 70_000, admitted: { sunset: 2, nonSunset: 0 }, zone: ZONE });
    expect(v.current?.entry.snapshotId).toBe(1);
    expect(v.current?.slot).toBe(3);
    expect(v.next[0].snapshotId).toBe(2);
    // The published end, not a grid boundary: shownSince plus this version's
    // dwell (spec §5.1). Every countdown reads this one number rather than
    // deriving its own.
    expect(v.schedule).toEqual({ slot: 3, nextBoundaryMs: 5 + D.dwellS * 1000 });
    expect(v.current?.endsAtMs).toBe(v.schedule.nextBoundaryMs);
    expect(v.lastPull.admitted.sunset).toBe(2);
  });
  it('rank is the position within the bin by score, ignoring queue membership', () => {
    const entries = [stored(1, 'sunset', 0.7), stored(2, 'sunset', 0.9)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    const byId = new Map(v.next.map((e) => [e.snapshotId, e.rank]));
    expect(byId.get(2)).toBe(1);
    expect(byId.get(1)).toBe(2);
  });
  it('echoes the raw entries and the zone so a client can re-project', () => {
    const entries = [stored(1, 'sunset', 0.9)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: 14 } });
    expect(v.entries).toHaveLength(1);
    expect(v.zone).toEqual({ minDeg: -24, maxDeg: 14 });
  });
});

describe('buildStateView with a version', () => {
  it('solo2 with valleys 1 alternates roles and draws peaks best-first, valleys worst-first', async () => {
    const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
    const v2 = SOLO_VERSIONS.solo2;
    const dials = { ...v2.dialsFrom(schemaDefaults(v2.schema)), valleys: 1 };
    const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8), stored(3, 'sunset', 0.7)];
    // The beat is off the slot COUNTER now, not the clock: with no screen row
    // the first projected draw is slot 0, a peak. Nothing here depends on
    // nowMs any more, which is the point of the change.
    const v = buildStateView({ feed: 'sunrise', dials, entries, screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, version: v2 });
    expect(v.nextRoles.slice(0, 4)).toEqual(['peak', 'valley', 'peak', 'valley']);
    expect(v.next.slice(0, 4).map((e) => e.snapshotId)).toEqual([1, 3, 2, 1]);
    // Starting from a stored slot 0 shifts the beat by one, and the wall clock
    // still has no say.
    const shifted = buildStateView({ feed: 'sunrise', dials, entries,
      screen: { feed: 'sunrise', currentSnapshotId: null, shownSince: null, slot: 0, sunsetStreak: 0 },
      nowMs: 999_999, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, version: v2 });
    expect(shifted.nextRoles.slice(0, 4)).toEqual(['valley', 'peak', 'valley', 'peak']);
  });
  it('solo2 with the camera run: the frames a draw plays share its stage, and the on-glass camera\'s frames are on glass', async () => {
    const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
    const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
    const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), rest: 0 };
    const cam = (id: number, webcamId: number, score: number, capturedAt: number) => ({ ...stored(id, 'sunset', score), webcamId, capturedAt });
    // Camera 7: 1 (old), 3 (new, on glass). Camera 9: 2 (old), 4 (new). Camera 11: 5 alone.
    const entries = [cam(1, 7, 0.6, 100), cam(2, 9, 0.7, 100), { ...cam(3, 7, 0.9, 300), tally: 1, lastShownAt: 0 }, cam(4, 9, 0.8, 300), cam(5, 11, 0.5, 200)];
    const v = buildStateView({ feed: 'sunset', dials: d2, entries, screen: { feed: 'sunset', currentSnapshotId: 3, shownSince: 0, slot: 0, sunsetStreak: 1 },
      nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, version: SOLO_VERSIONS.solo2 });
    const stageOf = (id: number) => [...v.bins.sunset, ...v.next, ...(v.current ? [v.current.entry] : [])].find((e) => e.snapshotId === id)!.stage;
    expect(v.next.map((e) => e.snapshotId).slice(0, 2)).toEqual([4, 5]); // newest frames stand for their cameras
    expect(stageOf(1)).toEqual({ kind: 'onGlass' });
    expect(stageOf(2)).toEqual(stageOf(4));
    expect(stageOf(2).kind).toBe('queued');
  });

  it('solo reports every draw as a peak', () => {
    const v = buildStateView({ feed: 'sunset', dials: D, entries: [stored(1, 'sunset', 0.9)], screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(v.nextRoles).toEqual(v.next.map(() => 'peak'));
  });
});

describe('buildStateView: the dwell is read from the draw, not recomputed', () => {
  // 2026-09-08: the end was recomputed from the live pool on every fetch, so
  // it moved while the frame was still on glass and the queue's projection
  // moved with it. The draw pins both; the view publishes what it pinned.
  const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8)];
  const shownSince = 1_700_000_000_000;
  const build = (screen: Parameters<typeof buildStateView>[0]['screen']) =>
    buildStateView({ feed: 'sunset', dials: D, entries, screen, nowMs: 1_000_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });

  it('prefers the pinned length over anything the dials would say now', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0, dwellMs: 22_000 });
    expect(v.current?.endsAtMs).toBe(shownSince + 22_000);
    expect(v.current?.endsAtMs).not.toBe(shownSince + D.dwellS * 1000);
  });

  it('publishes the frames the draw pinned, so the glass plays fact', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0, shownSnapshotIds: [2, 1] });
    expect(v.current?.shownSnapshotIds).toEqual([2, 1]);
  });

  it('falls back to the recompute for a row written before the pin', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0 });
    expect(v.current?.endsAtMs).toBe(shownSince + D.dwellS * 1000);
    expect(v.current?.shownSnapshotIds).toEqual([1]); // solo shows the pick alone
  });

  it('the countdown and the queue both start from the pinned end, never two numbers', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0, dwellMs: 22_000 });
    expect(v.schedule.nextBoundaryMs).toBe(v.current?.endsAtMs);
  });

  it('marks every pinned frame as on glass, not the ones a fresh run would pick', () => {
    const v = build({ feed: 'sunset', currentSnapshotId: 1, shownSince, slot: 9, sunsetStreak: 0, shownSnapshotIds: [2, 1] });
    const stage = (id: number) => [...v.bins.sunset, ...v.bins.nonSunset, ...v.next, v.current!.entry]
      .find((e) => e.snapshotId === id)?.stage;
    expect(stage(2)).toEqual({ kind: 'onGlass' });
    expect(stage(1)).toEqual({ kind: 'onGlass' });
  });
});
