import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EntryRow, MIN_FRAME_PX, PX_PER_S } from './EntryRow';

const e = {
  snapshotId: 7, webcamId: 3, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: true,
  tally: 2, enteredAt: 0, imageUrl: 'u', title: 'Pier', city: 'Lisbon', region: '', country: 'Portugal',
  eligible: true, rank: 1, capturedAt: 0, timezone: null, sunAltitudeDeg: null,
  stage: { kind: 'inLine' as const, position: 12 },
};

it('shows the reason line, scores, place, and the tags; no rank, no bold tally', () => {
  render(<EntryRow entry={e} feed="sunset" place="sunset" reason="draw 12 · shown ×2 · last 3 min ago" onClick={vi.fn()} />);
  expect(screen.getByText('draw 12 · shown ×2 · last 3 min ago')).toBeInTheDocument();
  expect(screen.queryByText(/^shown ×2$/)).toBeNull();
  expect(screen.queryByText(/bin #/)).toBeNull();
  expect(screen.getByText(/rating 4\.6 · sunset 88%/)).toBeInTheDocument();
  expect(screen.getByText('NEW')).toBeInTheDocument();
  expect(screen.getByText(/Lisbon, Portugal/)).toBeInTheDocument();
});

it('dims an under-floor frame without a FLOOR tag; a repeat keeps full strength and is tagged REPEAT', () => {
  render(<EntryRow entry={{ ...e, eligible: false, isNew: false, stage: { kind: 'underFloor', floor: 0.55 } }}
    feed="sunset" place="sunset" reason="rating 2.7 < 3.2" onClick={vi.fn()} />);
  expect(screen.queryByText('FLOOR')).toBeNull();
  expect(screen.getByText('rating 2.7 < 3.2')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveStyle({ opacity: '0.45' });
  cleanup();
  render(<EntryRow entry={e} feed="sunset" place="queue" repeat reason="draw 6 · shown ×2 · last 1 min ago" onClick={vi.fn()} />);
  expect(screen.getByText('REPEAT')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveStyle({ opacity: '1' });
});

it('non-sunset rows show only detection, and a click reports the entry', () => {
  const onClick = vi.fn();
  render(<EntryRow reason="draw 3 · shown ×2 · last 1 min ago" entry={{ ...e, bin: 'non_sunset', quality: null }} feed="sunset" place="non_sunset" onClick={onClick} />);
  expect(screen.queryByText(/rating/)).toBeNull();
  expect(screen.getByText(/sunset 88%/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 7 }));
});

const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán
const tz = { timezone: 'America/Mazatlan', region: 'BCS', country: 'Mexico' };

it('a run stacks the earlier frames above the newest one, each labelled i/k with its local time, inside one bin-coloured box', () => {
  const onClick = vi.fn();
  const earlier = [
    { ...e, ...tz, snapshotId: 5, imageUrl: 'u5', capturedAt: AT - 44 * 60_000 },
    { ...e, ...tz, snapshotId: 6, imageUrl: 'u6', capturedAt: AT - 28 * 60_000 },
  ];
  render(<EntryRow reason="draw 3 · shown ×2 · last 1 min ago" entry={{ ...e, ...tz, capturedAt: AT }} feed="sunset" place="queue" onClick={onClick}
    run={{ earlier, stepS: 20 / 3 }} rowS={20} />);
  const group = screen.getByRole('group');
  expect(group).toHaveStyle({ border: '2px solid #7ee2ac' });
  expect(group).toHaveAccessibleName('Pier: 3 frames in one dwell');
  // oldest first, the newest last; each is its own button; the count is on the first picture
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(3);
  expect(buttons[0]).toHaveTextContent('1/3 · 6:58 pm');
  expect(buttons[1]).toHaveTextContent('2/3 · 7:14 pm');
  expect(buttons[2]).toHaveTextContent('3/3');
  expect(buttons[2]).toHaveTextContent('Pier');
  expect(buttons[2]).toHaveTextContent('7:42 pm');
  // every frame carries a light border inside the group
  for (const b of buttons) expect(b).toHaveStyle({ border: '1px solid #2a3242' });
  fireEvent.click(buttons[0]);
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 5 }));
  expect(screen.queryByText(/^CAM/)).toBeNull();
  expect(screen.queryByText('PRELUDE')).toBeNull();
});

it('heights are time: every frame of the run gets the same share, never below a legible minimum', () => {
  const earlier = [{ ...e, snapshotId: 5, imageUrl: 'u5', capturedAt: 1 }];
  render(<EntryRow reason="draw 3 · shown ×2 · last 1 min ago" entry={{ ...e, capturedAt: 2 }} feed="sunset" place="queue" onClick={vi.fn()}
    run={{ earlier, stepS: 10 }} rowS={20} />);
  const [step, main] = screen.getAllByRole('button');
  expect(step).toHaveStyle({ height: `${10 * PX_PER_S}px` });
  expect(main).toHaveStyle({ minHeight: `${10 * PX_PER_S}px` });
  render(<EntryRow reason="draw 3 · shown ×2 · last 1 min ago" entry={{ ...e, capturedAt: 2 }} feed="sunset" place="queue" onClick={vi.fn()}
    run={{ earlier, stepS: 0.5 }} rowS={20} />);
  expect(screen.getAllByRole('button')[2]).toHaveStyle({ height: `${MIN_FRAME_PX}px` });
});

it('without a run the row keeps its shape, and rowS alone sets its height as time', () => {
  render(<EntryRow reason="draw 3 · shown ×2 · last 1 min ago" entry={e} feed="sunset" place="sunset" onClick={vi.fn()} rowS={20} />);
  const b = screen.getByRole('button');
  expect(b).toHaveStyle({ minHeight: `${20 * PX_PER_S}px`, border: '1.5px solid #7ee2ac' });
  expect(screen.queryByRole('group')).toBeNull();
});

it('a run of one is not a group', () => {
  render(<EntryRow reason="draw 3" entry={e} feed="sunset" place="sunset" onClick={vi.fn()} run={{ earlier: [], stepS: 20 }} />);
  expect(screen.queryByRole('group')).toBeNull();
});
