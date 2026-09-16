import { describe, it, expect } from 'vitest';
import { layoutStrip } from './pairLayout';
import type { EntryView, StateView, TapeEntry, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { StripFrame } from '@/app/lib/solo/replay';

/**
 * layoutStrip (one-tape spec §4.2, task 5): the pure half of PairTape — turns
 * one feed's server state plus its projection into ms-bounded blocks. No
 * pixels, no React; `PairTape.test.tsx` covers what those blocks look like
 * on screen.
 */

const T0 = 1_700_000_000_000;
const D = { dwellS: 20, fadeS: 0 };

function base(id: number, overrides: Partial<ViewEntry> = {}): ViewEntry {
  return {
    snapshotId: id, webcamId: 900 + id, bin: 'sunset', quality: 0.5, detection: 0.8,
    isNew: false, tally: 0, enteredAt: T0, lastShownAt: null,
    imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland',
    capturedAt: T0 + id, timezone: null, sunAltitudeDeg: null, credit: null,
    ...overrides,
  };
}
const entryView = (id: number, overrides: Partial<EntryView> = {}): EntryView => ({
  ...base(id), eligible: true, rank: 0, stage: { kind: 'inLine', position: null }, ...overrides,
});
const tapeEntry = (id: number, slot: number, shownAt: number, overrides: Partial<TapeEntry> = {}): TapeEntry => ({
  ...entryView(id), slot, shownAt, peakAtMs: null, rendezvous: false, shownSnapshotIds: [], ...overrides,
});

function view(overrides: Partial<StateView> = {}): StateView {
  return {
    feed: 'sunrise', dials: {} as StateView['dials'], current: null, next: [], nextRoles: [],
    bins: { sunset: [], nonSunset: [] }, schedule: { slot: 0, nextBoundaryMs: 0 },
    lastPull: { admitted: { sunset: 0, nonSunset: 0 } }, entries: [], zone: { minDeg: -90, maxDeg: 90 }, tape: [],
    ...overrides,
  };
}

function strip(id: number | null, shownAt: number, overrides: Partial<StripFrame> = {}): StripFrame {
  return {
    slot: 0, shownAt, snapshotId: id, webcamId: id != null ? 900 + id : null, bin: id != null ? 'sunset' : null,
    quality: id != null ? 0.5 : null, detection: id != null ? 0.8 : null, title: id != null ? `cam${id}` : '',
    imageUrl: id != null ? `u${id}` : '', capturedAt: shownAt, shownSnapshotIds: id != null ? [id] : [], repeat: false,
    dwellMs: D.dwellS * 1000, peakAtMs: null, rendezvous: false, dropped: 0, grown: 0,
    ...overrides,
  };
}

describe('past blocks', () => {
  it('measures endMs from the next draw, caps a held block at MAX_DWELLS, and marks it held', () => {
    const tape = [tapeEntry(1, 10, T0), tapeEntry(2, 11, T0 + 20_000), tapeEntry(3, 12, T0 + 40_000)];
    const held = view({ tape, current: { entry: entryView(9), shownSince: T0 + 40_000 + 60_000, slot: 13, endsAtMs: null, shownSnapshotIds: [], peakAtMs: null, rendezvous: false } });
    const blocks = layoutStrip({ view: held, projection: [], ghosts: [], liveDials: D, studioDials: D, nowMs: T0 });
    // Frame 3 stayed 60 s (three dwells) before the current frame took over.
    expect(blocks[0]).toMatchObject({ startMs: T0, endMs: T0 + 20_000, held: false });
    expect(blocks[2]).toMatchObject({ startMs: T0 + 40_000, endMs: T0 + 40_000 + 3 * 20_000, held: true });
  });

  it('falls back to one nominal dwell, unmeasured, when nothing follows and there is no current', () => {
    const tape = [tapeEntry(1, 10, T0)];
    const blocks = layoutStrip({ view: view({ tape }), projection: [], ghosts: [], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[0]).toMatchObject({ startMs: T0, endMs: T0 + 20_000, held: false });
  });
});

describe('current block', () => {
  it('is a blank, one nominal dwell wide at now, when nothing is on glass', () => {
    const blocks = layoutStrip({ view: view(), projection: [], ghosts: [], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[0]).toMatchObject({ kind: 'current', entry: null, startMs: T0, endMs: T0 + 20_000 });
  });
});

describe('next blocks: dropped and cut', () => {
  // A camera's series 1..6, capture order by id; the fit kept 1, 4 and 6 (the
  // peak). The whole climb (1..5, before peak 6) minus what's kept is dropped:
  // 2, 3, 5. Nothing left over for `cut` in this fixture (nothing beyond the
  // uncapped series exists to have been cut by the most-frames cap).
  const series = [1, 2, 3, 4, 5, 6].map((id) => base(id, { webcamId: 500, capturedAt: T0 + id * 1000, quality: id === 6 ? 0.95 : 0.3 }));

  it('dropped is the climb minus what played; cut excludes anything already dropped', () => {
    const v = view({ entries: series });
    const proj = [strip(6, T0 + 100_000, { webcamId: 500, shownSnapshotIds: [1, 4, 6], dwellMs: 12_000 })];
    const blocks = layoutStrip({ view: v, projection: proj, ghosts: [null], liveDials: D, studioDials: D, nowMs: T0 });
    const block = blocks[1];
    expect(block.dropped.map((f) => f.snapshotId).sort()).toEqual([2, 3, 5]);
    expect(block.cut).toEqual([]);
    expect(block.frames.map((f) => f.snapshotId)).toEqual([1, 4, 6]);
    expect(block.entry?.snapshotId).toBe(6);
  });

  it('a camera with no sunset frame among its series has nothing to drop', () => {
    const v = view({ entries: [base(41, { webcamId: 700, bin: 'non_sunset', quality: null })] });
    const proj = [strip(41, T0, { webcamId: 700, bin: 'non_sunset', quality: null, shownSnapshotIds: [41] })];
    const blocks = layoutStrip({ view: v, projection: proj, ghosts: [null], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[1].dropped).toEqual([]);
  });
});

describe('next blocks: blanks and boundaries', () => {
  it('a projected blank slot (nothing eligible) carries no entry and one nominal dwell', () => {
    const proj = [strip(null, T0, { dwellMs: null })];
    const blocks = layoutStrip({ view: view(), projection: proj, ghosts: [null], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[1]).toMatchObject({ kind: 'next', entry: null, startMs: T0, endMs: T0 + 20_000 });
  });

  it('endMs is shownAt + the strip frame\'s own dwellMs', () => {
    const proj = [strip(1, T0, { dwellMs: 36_000 })];
    const v = view({ entries: [base(1)] });
    const blocks = layoutStrip({ view: v, projection: proj, ghosts: [null], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[1].endMs).toBe(T0 + 36_000);
  });
});

describe('repeat', () => {
  it('is threaded across past, current, and projected: a second appearance anywhere on the strip is a repeat', () => {
    const tape = [tapeEntry(1, 10, T0)];
    const current = { entry: entryView(2), shownSince: T0 + 20_000, slot: 11, endsAtMs: T0 + 40_000, shownSnapshotIds: [], peakAtMs: null, rendezvous: false };
    const v = view({ tape, current, entries: [base(1), base(2)] });
    const proj = [strip(1, T0 + 40_000, { shownSnapshotIds: [1] })];
    const blocks = layoutStrip({ view: v, projection: proj, ghosts: [null], liveDials: D, studioDials: D, nowMs: T0 });
    expect(blocks[0].repeat).toBe(false); // frame 1's first appearance
    expect(blocks[1].repeat).toBe(false); // frame 2, never seen before
    expect(blocks[2].repeat).toBe(true); // frame 1 again
  });
});
