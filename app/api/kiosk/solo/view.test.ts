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
  it('current comes from the screen row and is excluded from next', () => {
    const entries = [stored(1, 'sunset', 0.9, 1), stored(2, 'sunset', 0.8)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries,
      screen: { feed: 'sunset', currentSnapshotId: 1, shownSince: 5, slot: 3, sunsetStreak: 1 },
      nowMs: 70_000, admitted: { sunset: 2, nonSunset: 0 }, zone: ZONE });
    expect(v.current?.entry.snapshotId).toBe(1);
    expect(v.current?.slot).toBe(3);
    expect(v.next[0].snapshotId).toBe(2);
    expect(v.schedule).toEqual({ slot: 3, nextBoundaryMs: 90_000 });
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
    // nowMs 0 on sunrise → slot 0 now, first draw at slot 1 (a valley).
    const v = buildStateView({ feed: 'sunrise', dials, entries, screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, version: v2 });
    expect(v.nextRoles.slice(0, 4)).toEqual(['valley', 'peak', 'valley', 'peak']);
    // Slot 4 is a peak with every frame shown: the one longest since shown (3) comes back before the best (1).
    expect(v.next.slice(0, 4).map((e) => e.snapshotId)).toEqual([3, 1, 2, 3]);
  });
  it('solo reports every draw as a peak', () => {
    const v = buildStateView({ feed: 'sunset', dials: D, entries: [stored(1, 'sunset', 0.9)], screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(v.nextRoles).toEqual(v.next.map(() => 'peak'));
  });
});
