import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntryRow } from './EntryRow';

const e = {
  snapshotId: 7, webcamId: 3, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: true,
  tally: 2, enteredAt: 0, imageUrl: 'u', title: 'Pier', city: 'Lisbon', region: '', country: 'Portugal',
  eligible: true, rank: 1,
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
