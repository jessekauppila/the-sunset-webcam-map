import { describe, it, expect, vi } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { buildStateView } from '@/app/api/kiosk/solo/view';
import { buildMirrorView, MIRROR_CACHE_CONTROL } from './view';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const solo2 = SOLO_VERSIONS.solo2 as SoloVersionSpec;
// Camera 7 has frames 1, 2, 3 (oldest to newest); camera 8 has frame 9; camera 6 has 4 and 5.
const entry = (id: number, capturedAt: number, webcamId = 7, quality = 0.9) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  lastShownAt: null, imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C',
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const pool = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8, 0.8), entry(4, 100, 6, 0.7), entry(5, 200, 6, 0.7)];
const NOW = 1_000_000_000_000;
const base = { feed: 'sunset' as const, dials: D, entries: pool, nowMs: NOW, panelPreset: 'dell-l', build: 'b1' };
const ids = (xs: { snapshotId: number }[]) => xs.map((e) => e.snapshotId);

describe('buildMirrorView', () => {
  it('names the cache policy the route sets', () => {
    expect(MIRROR_CACHE_CONTROL).toBe('public, s-maxage=1, stale-while-revalidate=4');
  });
  it('resolves the pinned run in play order and carries the next run for preload, nothing wider', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW - 4_000, slot: 12, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [1, 3] };
    const v = buildMirrorView({ ...base, screen });
    expect(v.feed).toBe('sunset');
    expect(v.version).toBe('solo2');
    expect(v.slot).toBe(12);
    expect(v.panelPreset).toBe('dell-l');
    expect(v.build).toBe('b1');
    expect(v.dials.beatS).toBe(D.beatS);
    expect(v.current?.entry.snapshotId).toBe(3);
    expect(v.current?.shownSnapshotIds).toEqual([1, 3]);
    expect(v.current?.endsAtMs).toBe(NOW + 16_000);
    // The next run is what the engine's first projected draw would play: the
    // same answer the state view gives, so the mirror is a trim, not a second
    // opinion.
    const state = buildStateView({ feed: 'sunset', dials: D, entries: pool, screen, nowMs: NOW, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: 0, maxDeg: 0 }, version: solo2 });
    const expectedNext = ids(solo2.shown(pool, state.next[0], D));
    expect(expectedNext.length).toBeGreaterThan(0);
    expect(ids(v.next)).toEqual(expectedNext);
    expect(ids(v.entries)).toEqual([...new Set([1, 3, ...expectedNext])]);
    expect(v).not.toHaveProperty('bins');
    expect(v).not.toHaveProperty('tape');
    expect(v).not.toHaveProperty('zone');
  });
  it('omits a pinned frame the pool has dropped, keeping the pinned ids so the step rate holds', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW, slot: 1, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [1, 2, 3] };
    const v = buildMirrorView({ ...base, entries: pool.filter((e) => e.snapshotId !== 2), screen });
    expect(v.current?.shownSnapshotIds).toEqual([1, 2, 3]);
    expect(ids(v.entries).slice(0, 2)).toEqual([1, 3]);
  });
  it('a row from before the dwell was pinned yields the drawn frame alone, never a re-derived run', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW, slot: 1, sunsetStreak: 1, dwellMs: null, shownSnapshotIds: null };
    const v = buildMirrorView({ ...base, screen });
    expect(v.current?.shownSnapshotIds).toEqual([3]);
    expect(ids(v.entries)[0]).toBe(3);
    expect(ids(v.entries)).not.toContain(1);
  });
  it('projects one draw, not the whole queue: the mirror reads only next[0]', () => {
    const spy = vi.spyOn(SOLO_VERSIONS.solo2, 'project');
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW, slot: 1, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [3] };
    buildMirrorView({ ...base, screen });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toBe(1); // n
    spy.mockRestore();
  });
  it('with no row: slot 0, no current, and the next run to preload', () => {
    const v = buildMirrorView({ ...base, screen: null });
    expect(v.slot).toBe(0);
    expect(v.current).toBeNull();
    expect(v.next.length).toBeGreaterThan(0);
    expect(ids(v.entries)).toEqual(ids(v.next));
    // The pages branch keys its black-until-ready on `dials`, so a feed with
    // an empty pool must still carry the dials and the preset.
    expect(v.dials.beatS).toBe(D.beatS);
    expect(v.panelPreset).toBe('dell-l');
  });
  it('keeps the slot when the frame on glass has aged out of the pool', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 77, shownSince: NOW, slot: 41, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [77] };
    const v = buildMirrorView({ ...base, screen });
    expect(v.slot).toBe(41);
    expect(v.current).toBeNull();
  });
});
