import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntryRow, MIN_FRAME_PX, PX_PER_S } from './EntryRow';

const e = {
  snapshotId: 7, webcamId: 3, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: true,
  tally: 2, enteredAt: 0, imageUrl: 'u', title: 'Pier', city: 'Lisbon', region: '', country: 'Portugal',
  eligible: true, rank: 1, capturedAt: 0, timezone: null, sunAltitudeDeg: null,
};

it('shows tally first, scores, place, and the tags', () => {
  render(<EntryRow entry={e} feed="sunset" place="sunset" onClick={vi.fn()} />);
  expect(screen.getByText('shown ×2')).toHaveStyle({ fontWeight: 800 });
  expect(screen.getByText(/q 0\.91/)).toBeInTheDocument();
  expect(screen.getByText(/d 0\.88/)).toBeInTheDocument();
  expect(screen.getByText('NEW')).toBeInTheDocument();
  expect(screen.getByText(/Lisbon, Portugal/)).toBeInTheDocument();
});

it('marks ineligible frames FLOOR and repeats as repeat', () => {
  render(<EntryRow entry={{ ...e, eligible: false, isNew: false }} feed="sunset" place="sunset" onClick={vi.fn()} />);
  expect(screen.getByText('FLOOR')).toBeInTheDocument();
  render(<EntryRow entry={e} feed="sunset" place="queue" repeat onClick={vi.fn()} />);
  expect(screen.getByText(/repeat/)).toBeInTheDocument();
});

it('non-sunset rows show only detection, and a click reports the entry', () => {
  const onClick = vi.fn();
  render(<EntryRow entry={{ ...e, bin: 'non_sunset', quality: null }} feed="sunset" place="non_sunset" onClick={onClick} />);
  expect(screen.queryByText(/q /)).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 7 }));
});

const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán
const tz = { timezone: 'America/Mazatlan', region: 'BCS', country: 'Mexico' };

it('a sequence stacks the earlier frames above the chosen one, each with its local time, inside one bin-coloured box', () => {
  const onClick = vi.fn();
  const earlier = [
    { ...e, ...tz, snapshotId: 5, imageUrl: 'u5', capturedAt: AT - 44 * 60_000 },
    { ...e, ...tz, snapshotId: 6, imageUrl: 'u6', capturedAt: AT - 28 * 60_000 },
  ];
  render(<EntryRow entry={{ ...e, ...tz, capturedAt: AT }} feed="sunset" place="queue" onClick={onClick}
    sequence={{ earlier, stepS: 1.5, holdS: 17 }} rowS={20} />);
  const group = screen.getByRole('group');
  expect(group).toHaveStyle({ border: '2px solid #7ee2ac' });
  // earlier frames first, the chosen frame last; each is its own button
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(3);
  expect(buttons[0]).toHaveTextContent('6:58 pm');
  expect(buttons[1]).toHaveTextContent('7:14 pm');
  expect(buttons[2]).toHaveTextContent('Pier');
  expect(buttons[2]).toHaveTextContent('7:42 pm');
  // every frame carries a light border inside the group
  for (const b of buttons) expect(b).toHaveStyle({ border: '1px solid #2a3242' });
  fireEvent.click(buttons[0]);
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 5 }));
});

it('heights are time: a prelude step, then the hold, at the shared scale, never below a legible minimum', () => {
  const earlier = [{ ...e, snapshotId: 5, imageUrl: 'u5', capturedAt: 1 }];
  render(<EntryRow entry={{ ...e, capturedAt: 2 }} feed="sunset" place="queue" onClick={vi.fn()}
    sequence={{ earlier, stepS: 4, holdS: 16 }} rowS={20} />);
  const [step, main] = screen.getAllByRole('button');
  expect(step).toHaveStyle({ height: `${4 * PX_PER_S}px` });
  expect(main).toHaveStyle({ minHeight: `${16 * PX_PER_S}px` });
  render(<EntryRow entry={{ ...e, capturedAt: 2 }} feed="sunset" place="queue" onClick={vi.fn()}
    sequence={{ earlier, stepS: 0.5, holdS: 19.5 }} rowS={20} />);
  expect(screen.getAllByRole('button')[2]).toHaveStyle({ height: `${MIN_FRAME_PX}px` });
});

it('without a sequence the row keeps its shape, and rowS alone sets its height as time', () => {
  render(<EntryRow entry={e} feed="sunset" place="sunset" onClick={vi.fn()} rowS={20} />);
  const b = screen.getByRole('button');
  expect(b).toHaveStyle({ minHeight: `${20 * PX_PER_S}px`, border: '1.5px solid #7ee2ac' });
  expect(screen.queryByRole('group')).toBeNull();
});

it('flags a frame that an earlier queued dwell already showed inside its prelude', () => {
  render(<EntryRow entry={e} feed="sunset" place="queue" preluded onClick={vi.fn()} />);
  expect(screen.getByText('PRELUDE')).toBeInTheDocument();
});
