// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';

const commitAdvance = vi.fn();
const getScreenState = vi.fn();
const growDwell = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  growDwell: (...a: unknown[]) => growDwell(...a),
}));

import { advanceIfDue, drawSlot, dwellEndMs, isDue, kioskSlackMs } from './advance';

const solo = SOLO_VERSIONS.solo as SoloVersionSpec;
const solo2 = SOLO_VERSIONS.solo2 as SoloVersionSpec;
const D = solo.dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const D2 = solo2.dialsFrom(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
const entry = (id: number, q: number, tally = 0) => ({
  feed: 'sunset' as const, snapshotId: id, webcamId: 100 + id, bin: 'sunset' as const, quality: q, detection: 0.9,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: '', city: '', region: '', country: '', lat: 0, lng: 0,
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});
const NOW = Date.UTC(2026, 8, 15, 17, 30, 0);
const row = (slot: number, shownSince: number | null, dwellMs: number | null) => ({
  feed: 'sunset' as const, currentSnapshotId: 2, shownSince, slot, sunsetStreak: 1, dwellMs, shownSnapshotIds: [2],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  commitAdvance.mockResolvedValue(true);
  getScreenState.mockResolvedValue(null);
  growDwell.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('dwellEndMs / isDue', () => {
  it('a row with a start and a span ends at their sum; anything less is due', () => {
    expect(dwellEndMs(row(4, NOW - 5_000, 20_000))).toBe(NOW + 15_000);
    expect(isDue(row(4, NOW - 5_000, 20_000), NOW)).toBe(false);
    expect(isDue(row(4, NOW - 25_000, 20_000), NOW)).toBe(true);
    expect(isDue(row(4, NOW - 20_000, 20_000), NOW)).toBe(true); // at the end is due
    expect(dwellEndMs(row(4, NOW, null))).toBeNull(); // a row from before the dwell was pinned
    expect(isDue(row(4, NOW, null), NOW)).toBe(true);
    expect(isDue(null, NOW)).toBe(true);
  });
});

describe('drawSlot', () => {
  it('draws the engine pick, commits it, and returns the new row with the pick', async () => {
    const entries = [entry(1, 0.9), entry(2, 0.8)];
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries, screenBefore: null, slot: 0, nowMs: NOW });
    expect(r.advanced).toBe(true);
    expect(r.screen).toMatchObject({ feed: 'sunset', currentSnapshotId: 1, slot: 0, sunsetStreak: 1, shownSnapshotIds: [1], shownSince: NOW });
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 1 }), 1,
      [expect.objectContaining({ snapshotId: 1 })], 'solo', D.dwellS * 1000, NOW, null, false);
    expect(entries[0].tally).toBe(1); // the frames shown are marked in the pool the caller holds
  });
  it('is a no-op for the slot already on the row', async () => {
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(7, NOW, 20_000), slot: 7, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: row(7, NOW, 20_000) });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('returns the old row when nothing is eligible', async () => {
    const floor3 = solo.dialsFrom({ ...schemaDefaults(SOLO_SETTINGS_SCHEMA), ratingFloor: 3 });
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: floor3, entries: [entry(1, 0.1)], screenBefore: null, slot: 0, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: null });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('returns the old row when the commit loses the race', async () => {
    commitAdvance.mockResolvedValue(false);
    const entries = [entry(1, 0.9)];
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries, screenBefore: null, slot: 0, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: null });
    expect(entries[0].tally).toBe(0);
  });
  it('solo2 starts the dwell on the nearest tick', async () => {
    const r = await drawSlot({ feed: 'sunset', version: solo2, dials: D2, entries: [entry(1, 0.9)], screenBefore: null, slot: 0, nowMs: NOW + 300 });
    expect(r.screen?.shownSince).toBe(NOW);
    expect(commitAdvance).toHaveBeenLastCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), NOW, null, false);
  });
});

describe('advanceIfDue', () => {
  it('leaves a running dwell alone', async () => {
    const before = row(4, NOW - 5_000, 20_000);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: before, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: before });
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(getScreenState).not.toHaveBeenCalled();
  });
  it('draws the next slot once the dwell has ended', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9), entry(2, 0.8)], screenBefore: row(4, NOW - 25_000, 20_000), nowMs: NOW });
    expect(r.advanced).toBe(true);
    expect(r.screen?.slot).toBe(5);
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 5, expect.anything(), expect.any(Number), expect.any(Array), 'solo', expect.any(Number), expect.any(Number), null, false);
  });
  it('draws slot 0 when there is no row', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: null, nowMs: NOW });
    expect(r.screen?.slot).toBe(0);
  });
  it('a row from before the dwell was pinned is due', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(4, NOW, null), nowMs: NOW });
    expect(r.screen?.slot).toBe(5);
  });
  it('the loser of a race answers with the winner\'s row', async () => {
    commitAdvance.mockResolvedValue(false);
    const winner = row(5, NOW, 20_000);
    getScreenState.mockResolvedValue(winner);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(4, NOW - 25_000, 20_000), nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: winner });
    expect(getScreenState).toHaveBeenCalledWith('sunset');
  });
  it('re-reads the row when nothing was eligible, so the answer is whatever stands', async () => {
    const floor3 = solo.dialsFrom({ ...schemaDefaults(SOLO_SETTINGS_SCHEMA), ratingFloor: 3 });
    const stale = row(4, NOW - 25_000, 20_000);
    getScreenState.mockResolvedValue(stale);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: floor3, entries: [entry(1, 0.1)], screenBefore: stale, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: stale });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});

describe('isDue with slack', () => {
  it('a kiosk-fired advance is due half a beat early, never less than a second; advance-on-read gets no slack', () => {
    const r = row(4, NOW - 19_000, 20_000); // ends 1 s from now
    expect(isDue(r, NOW, 0)).toBe(false);
    expect(isDue(r, NOW, 1_000)).toBe(true);
    expect(isDue(r, NOW + 1_000, 0)).toBe(true);
    expect(kioskSlackMs(D)).toBe(1_000); // solo has no beat: the floor
    expect(kioskSlackMs(D2)).toBe(Math.max((D2 as { beatS: number }).beatS * 500, 1_000));
  });
  it('advanceIfDue with no slack leaves a dwell that ends in 500 ms alone', async () => {
    const before = row(4, NOW - 19_500, 20_000);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: before, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: null, screen: before });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});

describe('drawSlot with the rendezvous seam', () => {
  it('commits peakAtMs and rendezvous from the fit, and sizes the dwell with dwellMsFor', async () => {
    const fitted = [entry(1, 0.9), entry(2, 0.8)];
    const fitting = {
      ...solo2,
      fitNext: () => ({ kind: 'fit' as const, frames: fitted, peakAtMs: NOW + 8_000 }),
      dwellMsFor: () => 12_000,
    } as unknown as SoloVersionSpec;
    const dials = { ...D2, rendezvous: true };
    getScreenState.mockImplementation(async (feed: string) => feed === 'sunrise'
      ? { feed: 'sunrise', currentSnapshotId: 9, shownSince: NOW, slot: 3, sunsetStreak: 0, dwellMs: 20_000, shownSnapshotIds: [9], peakAtMs: NOW + 8_000, rendezvous: false }
      : null);
    const r = await drawSlot({ feed: 'sunset', version: fitting, dials, entries: [entry(1, 0.9), entry(2, 0.8)], screenBefore: null, slot: 0, nowMs: NOW });
    expect(r.advanced).toBe(true);
    expect(r.decision).toBe('fit');
    expect(commitAdvance).toHaveBeenLastCalledWith('sunset', 0, expect.anything(), expect.any(Number), fitted, 'solo2', 12_000, NOW, NOW + 8_000, true);
    expect(r.screen).toMatchObject({ peakAtMs: NOW + 8_000, rendezvous: true, dwellMs: 12_000, shownSnapshotIds: [1, 2] });
    expect(getScreenState).toHaveBeenCalledWith('sunrise'); // the other screen's row, because the dial is on
  });
  it('with the dial off it never reads the other screen and commits a plain draw', async () => {
    const plain = { ...solo2, fitNext: () => ({ kind: 'plain' as const, frames: [entry(1, 0.9)], peakAtMs: null }), dwellMsFor: () => 8_000 } as unknown as SoloVersionSpec;
    const r = await drawSlot({ feed: 'sunset', version: plain, dials: { ...D2, rendezvous: false }, entries: [entry(1, 0.9)], screenBefore: null, slot: 0, nowMs: NOW });
    expect(r.decision).toBe('plain');
    expect(getScreenState).not.toHaveBeenCalled();
    expect(commitAdvance).toHaveBeenLastCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', 8_000, NOW, null, false);
  });
  it('a grow keeps the slot, lengthens the dwell by one beat per added frame, and draws nothing', async () => {
    const add = [entry(3, 0.7)];
    const growing = { ...solo2, fitNext: () => ({ kind: 'grow' as const, add }), dwellMsFor: () => 8_000 } as unknown as SoloVersionSpec;
    const before = { ...row(4, NOW - 25_000, 20_000), shownSnapshotIds: [2] };
    const entries = [entry(1, 0.9), entry(2, 0.8), entry(3, 0.7)];
    const r = await drawSlot({ feed: 'sunset', version: growing, dials: { ...D2, rendezvous: true }, entries, screenBefore: before, slot: 5, nowMs: NOW });
    expect(r).toMatchObject({ advanced: false, grown: true, decision: 'grow' });
    expect(growDwell).toHaveBeenCalledWith('sunset', 4, add, 20_000 + (D2 as { beatS: number }).beatS * 1000);
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(r.screen).toMatchObject({ slot: 4, dwellMs: 20_000 + (D2 as { beatS: number }).beatS * 1000, shownSnapshotIds: [2, 3] });
    expect(entries[2].tally).toBe(1);
  });
  it('a refused grow answers with the old row and nothing drawn', async () => {
    growDwell.mockResolvedValue(false);
    const growing = { ...solo2, fitNext: () => ({ kind: 'grow' as const, add: [entry(3, 0.7)] }), dwellMsFor: () => 8_000 } as unknown as SoloVersionSpec;
    const before = { ...row(4, NOW - 25_000, 20_000), shownSnapshotIds: [2] };
    const r = await drawSlot({ feed: 'sunset', version: growing, dials: { ...D2, rendezvous: true }, entries: [entry(2, 0.8), entry(3, 0.7)], screenBefore: before, slot: 5, nowMs: NOW });
    expect(r).toEqual({ advanced: false, grown: false, decision: 'grow', screen: before });
  });
  it('a grown answer from advanceIfDue is returned as the grown row, not re-read', async () => {
    const add = [entry(3, 0.7)];
    const growing = { ...solo2, fitNext: () => ({ kind: 'grow' as const, add }), dwellMsFor: () => 8_000 } as unknown as SoloVersionSpec;
    const before = { ...row(4, NOW - 25_000, 20_000), shownSnapshotIds: [2] };
    const r = await advanceIfDue({ feed: 'sunset', version: growing, dials: { ...D2, rendezvous: true }, entries: [entry(2, 0.8), entry(3, 0.7)], screenBefore: before, nowMs: NOW });
    expect(r.grown).toBe(true);
    expect(r.screen?.dwellMs).toBe(20_000 + (D2 as { beatS: number }).beatS * 1000);
    // The other screen's row is read, because the dial is on; this feed's own
    // row is not, because the grown row IS what this call just wrote.
    expect(getScreenState).not.toHaveBeenCalledWith('sunset');
  });
});
