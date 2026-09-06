import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tape, TAPE_PX_PER_S } from './Tape';
import type { EntryView, TapeEntry } from '@/app/api/kiosk/solo/view';

const entry = (id: number, bin: 'sunset' | 'non_sunset' = 'sunset'): EntryView => ({
  snapshotId: id, webcamId: 100 + id, bin, quality: bin === 'sunset' ? 0.8 : null, detection: 0.9, isNew: false, tally: 1,
  enteredAt: 0, imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland', capturedAt: 0,
  timezone: null, sunAltitudeDeg: null, eligible: true, rank: 1, stage: { kind: 'queued', position: 1 },
});
const drawn = (id: number, slot: number, shownAt: number, bin: 'sunset' | 'non_sunset' = 'sunset'): TapeEntry =>
  ({ ...entry(id, bin), slot, shownAt, stage: { kind: 'inLine', position: null } });

const D = { dwellS: 20, fadeS: 0 };
// Three draws 20 s apart; the current frame took over 20 s after the last.
const past = [drawn(1, 10, 0), drawn(2, 11, 20_000, 'non_sunset'), drawn(1, 12, 40_000)];
const since = 60_000;

it('lays out past, current, seam, and projected in order, outlined by bin', () => {
  render(<Tape past={past} current={entry(3)} currentSince={since} next={[entry(4, 'non_sunset'), entry(1)]}
    pastDials={D} nextDials={D} onSelect={vi.fn()} />);
  const strip = screen.getByTestId('tape');
  const ids = [...strip.querySelectorAll('[data-testid^="tape-"]')].map((n) => n.getAttribute('data-testid'));
  expect(ids).toEqual(['tape-past-1-10', 'tape-past-2-11', 'tape-past-1-12', 'tape-current', 'tape-seam', 'tape-next-0', 'tape-next-1']);
  expect(screen.getByTestId('tape-past-1-10')).toHaveStyle({ borderLeftColor: '#7ee2ac' });
  expect(screen.getByTestId('tape-past-2-11')).toHaveStyle({ borderLeftColor: '#c3cad6' });
  expect(screen.getByTestId('tape-current')).toHaveStyle({ boxShadow: '0 0 0 2px #f5a344' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderLeftStyle: 'dashed' });
});

it('width is time: a dwell is dwellS × px/s; a frame held on glass is wider and says so; the projection is one dwell each', () => {
  const held = [drawn(1, 10, 0), drawn(2, 11, 20_000), drawn(3, 12, 40_000)];
  // Frame 3 stayed 60 s (three dwells) before the current frame took over.
  render(<Tape past={held} current={entry(9)} currentSince={100_000} next={[entry(4)]} pastDials={D} nextDials={{ dwellS: 30, fadeS: 0 }} onSelect={vi.fn()} />);
  expect(screen.getByTestId('tape-past-1-10')).toHaveStyle({ width: `${20 * TAPE_PX_PER_S}px` });
  expect(screen.getByTestId('tape-past-3-12')).toHaveStyle({ width: `${60 * TAPE_PX_PER_S}px` });
  expect(screen.getByTestId('tape-held')).toBeInTheDocument();
  expect(screen.getByTestId('tape-past-3-12').getAttribute('title')).toMatch(/on glass 60 s · held/);
  expect(screen.getByTestId('tape-past-1-10').getAttribute('title')).toMatch(/on glass 20 s$/);
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ width: `${30 * TAPE_PX_PER_S}px` });
});

it('a crossfade is an X as wide as the fade dial, straddling every cut; fade 0 draws none', () => {
  const { unmount } = render(<Tape past={past} current={entry(3)} currentSince={since} next={[entry(4), entry(5)]}
    pastDials={{ dwellS: 20, fadeS: 2 }} nextDials={{ dwellS: 20, fadeS: 4 }} onSelect={vi.fn()} />);
  // past→past ×2, past→current, current→next, next→next
  expect(screen.getAllByTestId(/^tape-fade-/)).toHaveLength(5);
  expect(screen.getByTestId('tape-fade-0')).toHaveStyle({ width: `${2 * TAPE_PX_PER_S}px` });
  expect(screen.getByTestId('tape-fade-3')).toHaveStyle({ width: `${4 * TAPE_PX_PER_S}px` });
  expect(screen.getByTestId('tape-fade-3').getAttribute('title')).toMatch(/crossfade 4 s/);
  unmount();
  render(<Tape past={past} current={entry(3)} currentSince={since} next={[entry(4)]} pastDials={D} nextDials={D} onSelect={vi.fn()} />);
  expect(screen.queryAllByTestId(/^tape-fade-/)).toHaveLength(0);
});

it('a frame that already appears earlier on the strip gets the red top edge; the first appearance does not', () => {
  render(<Tape past={past} current={entry(3)} currentSince={since} next={[entry(1)]} pastDials={D} nextDials={D} onSelect={vi.fn()} />);
  expect(screen.getByTestId('tape-past-1-10')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-past-1-12')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-current')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
});

it('hover text names the frame and its time; clicking any thumb, past included, reports the entry', () => {
  const onSelect = vi.fn();
  render(<Tape past={past} current={entry(3)} currentSince={since} next={[entry(4)]} pastDials={D} nextDials={D} onSelect={onSelect} />);
  expect(screen.getByTestId('tape-past-1-10').getAttribute('title')).toMatch(/cam1 · Nuuk, Greenland · draw at/);
  expect(screen.getByTestId('tape-next-0').getAttribute('title')).toMatch(/^draw 1 · cam4/);
  fireEvent.click(screen.getByTestId('tape-past-2-11'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 2, slot: 11 }));
  fireEvent.click(screen.getByTestId('tape-next-0'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 4 }));
  fireEvent.click(screen.getByTestId('tape-current'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 3 }));
});

it('a projected dwell with a prelude shows the earlier frames as narrow sub-blocks before the chosen one, inside one dwell', () => {
  const earlier = [entry(7), entry(8)];
  render(<Tape past={[]} current={entry(3)} next={[entry(4)]} nextSequences={[{ earlier, stepS: 1.5, holdS: 17 }]}
    pastDials={D} nextDials={D} onSelect={vi.fn()} />);
  const group = screen.getByTestId('tape-next-0-group');
  const ids = [...group.querySelectorAll('[data-testid^="tape-next-0"]')].map((n) => n.getAttribute('data-testid'));
  expect(ids).toEqual(['tape-next-0-pre-7', 'tape-next-0-pre-8', 'tape-next-0']);
  expect(screen.getByTestId('tape-next-0-pre-7')).toHaveStyle({ width: '6px' }); // 1.5 s × 3 px = 4.5, floored to the legible minimum
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ width: `${20 * TAPE_PX_PER_S - 12}px` });
  expect(screen.getByTestId('tape-next-0').getAttribute('title')).toMatch(/after 2 earlier frames of this camera, 1.5 s each/);
});

it('with no past and nothing on glass it renders a blank, the seam, and the projection', () => {
  render(<Tape past={[]} current={null} next={[entry(4)]} pastDials={D} nextDials={D} onSelect={vi.fn()} />);
  expect(screen.queryByTestId('tape-current')).toBeNull();
  expect(screen.getByTestId('tape-blank')).toBeInTheDocument();
  expect(screen.getByTestId('tape-seam')).toBeInTheDocument();
  expect(screen.getByTestId('tape-next-0')).toBeInTheDocument();
  expect(screen.getByText(/no draws logged yet/)).toBeInTheDocument();
});
