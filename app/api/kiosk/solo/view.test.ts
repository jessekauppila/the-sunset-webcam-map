import { describe, it, expect } from 'vitest';
import { buildStateView, parseFeed, toViewEntry, type ViewEntry } from './view';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const ZONE = { minDeg: -24, maxDeg: -2 };
const stored = (id: number, bin: 'sunset' | 'non_sunset', score: number, tally = 0): ViewEntry => ({
  snapshotId: id, webcamId: 100 + id, bin,
  quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '',
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
    });
    expect(v).not.toHaveProperty('lat');
    expect(v).not.toHaveProperty('feed');
    expect(v).toMatchObject({ snapshotId: 1, quality: 0.9, title: 't1' });
  });
});

describe('buildStateView', () => {
  it('queued frames are absent from the bins; bins keep the remainder ranked by score', () => {
    const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8), stored(3, 'non_sunset', 0.5), stored(4, 'sunset', 0.1)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(v.current).toBeNull();
    // Three eligible frames project eight draws: the cycle repeats, which is
    // exactly what the glass will do, so the queue shows it.
    expect(v.next.map((e) => e.snapshotId)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect(v.bins.sunset.map((e) => e.snapshotId)).toEqual([4]);
    expect(v.bins.sunset[0].eligible).toBe(false);
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
