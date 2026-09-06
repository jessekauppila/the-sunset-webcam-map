import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tape } from './Tape';
import type { EntryView } from '@/app/api/kiosk/solo/view';

const entry = (id: number, bin: 'sunset' | 'non_sunset' = 'sunset'): EntryView => ({
  snapshotId: id, webcamId: 100 + id, bin, quality: bin === 'sunset' ? 0.8 : null, detection: 0.9, isNew: false, tally: 1,
  enteredAt: 0, imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland', capturedAt: 0,
  timezone: null, sunAltitudeDeg: null, eligible: true, rank: 1, stage: { kind: 'queued', position: 1 },
});
const past = [
  { slot: 10, snapshotId: 1, shownAt: 1_000, imageUrl: 'u1', title: 'cam1', city: 'Nuuk', country: 'Greenland', bin: 'sunset' as const },
  { slot: 11, snapshotId: 2, shownAt: 2_000, imageUrl: 'u2', title: 'cam2', city: '', country: '', bin: 'non_sunset' as const },
  { slot: 12, snapshotId: 1, shownAt: 3_000, imageUrl: 'u1', title: 'cam1', city: 'Nuuk', country: 'Greenland', bin: 'sunset' as const },
];

it('lays out past, current, seam, and projected in order, outlined by bin', () => {
  render(<Tape past={past} current={entry(3)} next={[entry(4, 'non_sunset'), entry(1)]} onSelect={vi.fn()} />);
  const strip = screen.getByTestId('tape');
  const ids = [...strip.querySelectorAll('[data-testid^="tape-"]')].map((n) => n.getAttribute('data-testid'));
  expect(ids).toEqual(['tape-past-1-10', 'tape-past-2-11', 'tape-past-1-12', 'tape-current', 'tape-seam', 'tape-next-0', 'tape-next-1']);
  expect(screen.getByTestId('tape-past-1-10')).toHaveStyle({ borderLeftColor: '#7ee2ac' });
  expect(screen.getByTestId('tape-past-2-11')).toHaveStyle({ borderLeftColor: '#c3cad6' });
  expect(screen.getByTestId('tape-current')).toHaveStyle({ boxShadow: '0 0 0 2px #f5a344' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderLeftStyle: 'dashed' });
});

it('a frame that already appears earlier on the strip gets the red top edge; the first appearance does not', () => {
  render(<Tape past={past} current={entry(3)} next={[entry(1)]} onSelect={vi.fn()} />);
  expect(screen.getByTestId('tape-past-1-10')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-past-1-12')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-current')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
});

it('hover text names the frame; clicking a projected or current thumb reports the entry', () => {
  const onSelect = vi.fn();
  render(<Tape past={past} current={entry(3)} next={[entry(4)]} onSelect={onSelect} />);
  expect(screen.getByTestId('tape-past-1-10').getAttribute('title')).toMatch(/cam1 · Nuuk, Greenland · draw at/);
  expect(screen.getByTestId('tape-next-0').getAttribute('title')).toMatch(/^draw 1 · cam4/);
  fireEvent.click(screen.getByTestId('tape-next-0'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 4 }));
  fireEvent.click(screen.getByTestId('tape-current'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 3 }));
});

it('with no past and nothing on glass it still renders the seam and the projection', () => {
  render(<Tape past={[]} current={null} next={[entry(4)]} onSelect={vi.fn()} />);
  expect(screen.queryByTestId('tape-current')).toBeNull();
  expect(screen.getByTestId('tape-seam')).toBeInTheDocument();
  expect(screen.getByTestId('tape-next-0')).toBeInTheDocument();
  expect(screen.getByText(/no draws logged yet/)).toBeInTheDocument();
});
