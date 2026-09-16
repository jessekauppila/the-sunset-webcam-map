import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PairTape } from './PairTape';
import type { StateView, TapeEntry, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { StripFrame, Landing } from '@/app/lib/solo/replay';
import type { Feed } from '@/app/lib/solo/types';
import type { TapeDials } from './tapeParts';
import type { PairProjection } from './projectPair';
import { PX_PER_S } from './timeScale';

/**
 * PairTape (one-tape spec §4, task 5): one strip for both screens on a
 * shared time axis. Fixtures are hand-built StateViews and StripFrames, like
 * projectPair.test.ts's own — no fetch, no store, no real projection.
 */

const T0 = 1_700_000_000_000;
const D: TapeDials = { dwellS: 20, fadeS: 0 };
const D2: TapeDials = { dwellS: 12, fadeS: 0, beatS: 4 };

function base(id: number, overrides: Partial<ViewEntry> = {}): ViewEntry {
  return {
    snapshotId: id, webcamId: 900 + id, bin: 'sunset', quality: 0.5, detection: 0.8,
    isNew: false, tally: 0, enteredAt: T0, lastShownAt: null,
    imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland',
    capturedAt: T0 + id, timezone: null, sunAltitudeDeg: null, credit: null,
    ...overrides,
  };
}
const entryView = (id: number, overrides: Partial<ViewEntry> = {}): ViewEntry & { eligible: boolean; rank: number; stage: { kind: 'inLine'; position: null } } => ({
  ...base(id, overrides), eligible: true, rank: 0, stage: { kind: 'inLine', position: null },
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

function projection(overrides: Partial<PairProjection> = {}): PairProjection {
  return {
    sunrise: [], sunset: [], landings: [], counts: {
      made: 0, missed: 0, missReasons: { 'no partner': 0, 'too soon': 0, 'nothing to add': 0 }, eligible: { sunrise: 0, sunset: 0 }, dropped: 0, grown: 0, landings: [],
    },
    ghosts: { sunrise: [], sunset: [] },
    ...overrides,
  };
}

const dials = (feed: Partial<Record<Feed, TapeDials>> = {}): Record<Feed, TapeDials> => ({ sunrise: D, sunset: D, ...feed });

function renderTape(props: Partial<Parameters<typeof PairTape>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <PairTape
      sunrise={view()} sunset={view()} projection={projection()} liveDials={dials()} studioDials={dials()}
      nowMs={T0} onSelect={onSelect} {...props}
    />,
  );
  return onSelect;
}

describe('one axis', () => {
  it('a sunrise past block and a sunset projected block starting at the same instant sit at the same x', () => {
    const T = T0 + 60_000;
    const sunrise = view({ tape: [tapeEntry(1, 10, T)], entries: [base(1)] });
    const sunset = view({ entries: [base(2)] });
    const proj = projection({ sunset: [strip(2, T, { dwellMs: 20_000 })] });
    renderTape({ sunrise, sunset, projection: proj });
    // The positioned element is each thumb's wrapping div (`left` in ms→px);
    // the thumb itself carries no position, only size.
    const past = screen.getByTestId('tape-past-1-10').parentElement!;
    const next = screen.getByTestId('tape-next-sunset-0').parentElement!;
    expect(past.style.left).not.toBe('');
    expect(past.style.left).toBe(next.style.left);
  });
});

describe('a tie spans the rows', () => {
  it('draws exactly three tape-tie elements, one per row, all at the same x, and the ruler one carries the clock', () => {
    const L = T0 + 40_000;
    const landing: Landing = { atMs: L, sunriseSlot: 0, sunsetSlot: 0 };
    const sunrise = view({ entries: [base(1)] });
    const sunset = view({ entries: [base(2)] });
    const proj = projection({
      sunrise: [strip(1, L, { dwellMs: 20_000 })], sunset: [strip(2, L, { dwellMs: 20_000 })], landings: [landing],
    });
    renderTape({ sunrise, sunset, projection: proj });
    const ties = screen.getAllByTestId('tape-tie');
    expect(ties).toHaveLength(3);
    const lefts = new Set(ties.map((t) => t.style.left));
    expect(lefts.size).toBe(1);
    const withClock = ties.find((t) => t.textContent && t.textContent.length > 0);
    expect(withClock).toBeDefined();
  });
});

describe('a past tie', () => {
  it('draws one line where a rendezvous past row matches the other feed\'s peakAtMs; an unmatched one draws none', () => {
    const P = T0 + 20_000;
    const sunrise = view({ tape: [tapeEntry(1, 10, T0, { rendezvous: true, peakAtMs: P })], entries: [base(1)] });
    const sunset = view({ tape: [tapeEntry(2, 10, T0, { peakAtMs: P })], entries: [base(2)] });
    renderTape({ sunrise, sunset });
    expect(screen.getAllByTestId('tape-tie')).toHaveLength(1);
    cleanup();
    const sunriseUnmatched = view({ tape: [tapeEntry(1, 10, T0, { rendezvous: true, peakAtMs: P })], entries: [base(1)] });
    const sunsetNoMatch = view({ tape: [tapeEntry(2, 10, T0, { peakAtMs: P + 99_000 })], entries: [base(2)] });
    renderTape({ sunrise: sunriseUnmatched, sunset: sunsetNoMatch });
    expect(screen.queryAllByTestId('tape-tie')).toHaveLength(0);
  });
});

describe('dropped stubs in place', () => {
  it('draws one stub per dropped id, orange-edged, between the kept frames, and labels the count', () => {
    const series = [1, 2, 3, 4, 5, 6].map((id) => base(id, { webcamId: 500, capturedAt: T0 + id * 1000, quality: id === 6 ? 0.95 : 0.3 }));
    const sunrise = view({ entries: series });
    const proj = projection({ sunrise: [strip(6, T0 + 100_000, { webcamId: 500, shownSnapshotIds: [1, 4, 6], dwellMs: 12_000 })] });
    renderTape({ sunrise, projection: proj });
    expect(screen.getByTestId('tape-dropped-2')).toBeInTheDocument();
    expect(screen.getByTestId('tape-dropped-3')).toBeInTheDocument();
    expect(screen.getByTestId('tape-dropped-5')).toBeInTheDocument();
    expect(screen.getByTestId('tape-dropped-2-edge')).toBeInTheDocument();
    expect(screen.getByText('dropped 3')).toBeInTheDocument();
    const kept1 = screen.getByTestId('tape-next-sunrise-0-pre-1');
    const kept4 = screen.getByTestId('tape-next-sunrise-0-pre-4');
    const dropped2 = screen.getByTestId('tape-dropped-2');
    // Dropped id 2 sits between kept frames 1 and 4.
    expect(parseFloat(dropped2.parentElement!.style.left)).toBeGreaterThan(parseFloat(kept1.parentElement!.style.left));
    expect(parseFloat(dropped2.parentElement!.style.left)).toBeLessThan(parseFloat(kept4.parentElement!.style.left));
  });
});

describe('grown edge and label', () => {
  it('the last `grown` sub-blocks carry the orange edge, and the label says so', () => {
    const sunrise = view({ entries: [base(1, { webcamId: 500 }), base(2, { webcamId: 500 }), base(3, { webcamId: 500 })] });
    const proj = projection({ sunrise: [strip(3, T0, { webcamId: 500, shownSnapshotIds: [1, 2, 3], grown: 2, dwellMs: 12_000 })] });
    renderTape({ sunrise, projection: proj });
    expect(screen.queryByTestId('tape-next-sunrise-0-pre-1-edge')).toBeNull();
    expect(screen.getByTestId('tape-next-sunrise-0-pre-2-edge')).toBeInTheDocument();
    expect(screen.getByTestId('tape-next-sunrise-0-edge')).toBeInTheDocument();
    expect(screen.getByText('grew +2')).toBeInTheDocument();
  });
});

describe('ghost', () => {
  it('draws a ghost and a "peak moved" label when the unfitted peak differs by at least a beat; equal draws none', () => {
    const sunrise = view({ entries: [base(1)] });
    const peakAtMs = T0 + 40_000;
    const proj = projection({
      sunrise: [strip(1, T0, { peakAtMs, rendezvous: true, dwellMs: 12_000 })],
      ghosts: { sunrise: [peakAtMs + 8_000], sunset: [] },
    });
    renderTape({ sunrise, projection: proj, studioDials: dials({ sunrise: D2, sunset: D2 }) });
    expect(screen.getByTestId('tape-ghost')).toBeInTheDocument();
    expect(screen.getByText('peak moved -8 s')).toBeInTheDocument();
    cleanup();
    const projEqual = projection({
      sunrise: [strip(1, T0, { peakAtMs, rendezvous: true, dwellMs: 12_000 })],
      ghosts: { sunrise: [peakAtMs], sunset: [] },
    });
    renderTape({ sunrise, projection: projEqual, studioDials: dials({ sunrise: D2, sunset: D2 }) });
    expect(screen.queryByTestId('tape-ghost')).toBeNull();
  });
});

describe('beat grid', () => {
  it('draws adjacent tape-beat lines beatS × px apart', () => {
    renderTape({ liveDials: dials({ sunrise: D2, sunset: D2 }), studioDials: dials({ sunrise: D2, sunset: D2 }) });
    const lines = screen.getAllByTestId('tape-beat');
    expect(lines.length).toBeGreaterThan(1);
    const diff = parseFloat(lines[1].style.left) - parseFloat(lines[0].style.left);
    expect(diff).toBe(16); // 4 s beat × 4 px/s at zoom 1
  });
});

describe('solo', () => {
  it('with no landings and null ghosts, renders both strips and no ties or ghosts', () => {
    const sunrise = view({ tape: [tapeEntry(1, 10, T0)], entries: [base(1), base(2)] });
    const sunset = view({ tape: [tapeEntry(2, 10, T0)], entries: [base(1), base(2)] });
    const proj = projection({
      sunrise: [strip(3, T0 + 20_000)], sunset: [strip(4, T0 + 20_000)],
      ghosts: { sunrise: [null], sunset: [null] },
    });
    renderTape({ sunrise, sunset, projection: proj });
    expect(screen.getByTestId('tape-past-1-10')).toBeInTheDocument();
    expect(screen.getByTestId('tape-past-2-10')).toBeInTheDocument();
    expect(screen.queryAllByTestId('tape-tie')).toHaveLength(0);
    expect(screen.queryAllByTestId('tape-ghost')).toHaveLength(0);
  });
});

describe('click', () => {
  it('clicking a projected block\'s last frame calls onSelect with that entry, the feed, and a list containing it', () => {
    const sunrise = view({ entries: [base(4)] });
    const proj = projection({ sunrise: [strip(4, T0, { dwellMs: 20_000 })] });
    const onSelect = renderTape({ sunrise, projection: proj });
    fireEvent.click(screen.getByTestId('tape-next-sunrise-0'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: 4 }),
      'sunrise',
      expect.arrayContaining([expect.objectContaining({ snapshotId: 4 })]),
    );
  });

  it('an earlier run frame, a dropped stub, and a cut stub each call onSelect with a list containing themselves', () => {
    // Camera 700's series, ids 1..7 by capture order; id 4 is the peak. The
    // dwell played 2, 4, 6: 1 and 3 (climb, before the peak) are dropped;
    // 5 and 7 (after the peak, not kept) are cut.
    const wc = 700;
    const series = [1, 2, 3, 4, 5, 6, 7].map((id) => base(id, { webcamId: wc, capturedAt: T0 + id * 1000, quality: id === 4 ? 0.99 : 0.3 }));
    const sunrise = view({ entries: series });
    const proj = projection({ sunrise: [strip(6, T0, { webcamId: wc, shownSnapshotIds: [2, 4, 6], dwellMs: 20_000 })] });
    const onSelect = renderTape({ sunrise, projection: proj });

    fireEvent.click(screen.getByTestId('tape-next-sunrise-0-pre-2'));
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotId: 2 }), 'sunrise', expect.arrayContaining([expect.objectContaining({ snapshotId: 2 })]),
    );

    fireEvent.click(screen.getByTestId('tape-dropped-1'));
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotId: 1 }), 'sunrise', expect.arrayContaining([expect.objectContaining({ snapshotId: 1 })]),
    );

    fireEvent.click(screen.getByTestId('tape-next-sunrise-0-cut-5'));
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshotId: 5 }), 'sunrise', expect.arrayContaining([expect.objectContaining({ snapshotId: 5 })]),
    );
  });
});

describe('sub-block widths always sum to the block width', () => {
  it('with a beat dial: one beat each for the earlier frames, the last takes the rest', () => {
    const dwellMs = 60_000;
    const sunrise = view({ entries: [base(1), base(2), base(3)] });
    const proj = projection({ sunrise: [strip(3, T0, { shownSnapshotIds: [1, 2, 3], dwellMs })] });
    renderTape({ sunrise, projection: proj, studioDials: dials({ sunrise: D2, sunset: D2 }) });
    const w1 = parseFloat(screen.getByTestId('tape-next-sunrise-0-pre-1').style.width);
    const w2 = parseFloat(screen.getByTestId('tape-next-sunrise-0-pre-2').style.width);
    const w3 = parseFloat(screen.getByTestId('tape-next-sunrise-0').style.width);
    const expected = (dwellMs / 1000) * PX_PER_S;
    expect(Math.abs(w1 + w2 + w3 - expected)).toBeLessThanOrEqual(1);
  });

  it('without a beat dial: each frame gets an equal share', () => {
    const dwellMs = 30_000;
    const sunrise = view({ entries: [base(1), base(2), base(3)] });
    const proj = projection({ sunrise: [strip(3, T0, { shownSnapshotIds: [1, 2, 3], dwellMs })] });
    renderTape({ sunrise, projection: proj }); // default studioDials: D, no beatS
    const w1 = parseFloat(screen.getByTestId('tape-next-sunrise-0-pre-1').style.width);
    const w2 = parseFloat(screen.getByTestId('tape-next-sunrise-0-pre-2').style.width);
    const w3 = parseFloat(screen.getByTestId('tape-next-sunrise-0').style.width);
    const expected = (dwellMs / 1000) * PX_PER_S;
    expect(Math.abs(w1 + w2 + w3 - expected)).toBeLessThanOrEqual(1);
  });
});
