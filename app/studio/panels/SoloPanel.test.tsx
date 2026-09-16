import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SoloPanel, type SoloFeedState } from './SoloPanel';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { buildStateView, type ViewEntry } from '@/app/api/kiosk/solo/view';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';

vi.mock('@/app/components/Webcam/FrameLabelCard', () => ({
  FrameLabelCard: ({ webcam }: { webcam: { title: string } }) => <div data-testid="card">{webcam.title}</div>,
}));

const D = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), ratingFloor: 3.2 }; // quality 0.55: frame 4 (0.1) is below it
const entry = (id: number, bin: 'sunset' | 'non_sunset', score: number, webcamId = 100 + id): ViewEntry => ({
  snapshotId: id, webcamId, bin, quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally: 0, enteredAt: id, imageUrl: `u${id}`, title: `cam${id}`, city: '', region: '', country: '',
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});
// Borrowed from FeedColumn.test.tsx: 4 entries, frame 4 below the rating floor.
const view = (feed: 'sunrise' | 'sunset', dials = D) => buildStateView({
  feed, dials,
  entries: [entry(1, 'sunset', 0.9), entry(2, 'sunset', 0.8, 101), entry(3, 'non_sunset', 0.5), entry(4, 'sunset', 0.1)],
  screen: { feed, currentSnapshotId: 1, shownSince: 0, slot: 0, sunsetStreak: 1 },
  nowMs: 0, admitted: { sunset: 1, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 },
});

const stateOf = (feed: 'sunrise' | 'sunset'): SoloFeedState => {
  const v = view(feed);
  return { server: v, projected: v, error: undefined };
};

it('renders both feed columns', () => {
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={stateOf('sunrise')} sunset={stateOf('sunset')} />);
  expect(screen.getByText(/Sunrise · left screen/)).toBeInTheDocument();
  expect(screen.getByText(/Sunset · right screen/)).toBeInTheDocument();
});

it('clicking a row opens FrameModal, and its close control hides it', () => {
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={stateOf('sunrise')} sunset={stateOf('sunset')} />);
  expect(screen.queryByTestId('frame-line')).toBeNull();
  fireEvent.click(screen.getAllByText('cam1')[0]);
  expect(screen.getByTestId('frame-line')).toBeInTheDocument();
  fireEvent.click(screen.getByText('close'));
  expect(screen.queryByTestId('frame-line')).toBeNull();
});

it('one tape carries both screens, above the two columns', () => {
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={stateOf('sunrise')} sunset={stateOf('sunset')} />);
  const tape = screen.getByTestId('pair-tape');
  expect(screen.getByText(/sunrise above, sunset below/)).toBeInTheDocument();
  // Both screens are on the one strip, and it precedes the columns.
  expect(screen.getByTestId('tape-current-sunrise')).toBeInTheDocument();
  expect(screen.getByTestId('tape-current-sunset')).toBeInTheDocument();
  const heading = screen.getByText(/Sunrise · left screen/);
  expect(tape.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('the tape button folds the tape away and back', () => {
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={stateOf('sunrise')} sunset={stateOf('sunset')} />);
  fireEvent.click(screen.getByRole('button', { name: /tape/ }));
  expect(screen.queryByTestId('pair-tape')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /tape/ }));
  expect(screen.getByTestId('pair-tape')).toBeInTheDocument();
});

it('clicking a block on the tape opens the pop-up at THAT frame, not at the head of the list', () => {
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={stateOf('sunrise')} sunset={stateOf('sunset')} />);
  expect(screen.queryByTestId('frame-line')).toBeNull();
  // A PROJECTED block, not the one on glass: the on-glass frame is already the
  // head of the tape's list, so clicking it cannot tell a real lookup apart
  // from a handler that always opened at list[0].
  const block = screen.getByTestId('tape-next-sunrise-0');
  const id = Number((block.querySelector('img')?.getAttribute('src') ?? '').replace('u', ''));
  expect(id).toBeGreaterThan(0);
  expect(id).not.toBe(1); // 1 is on glass, and first in the list
  fireEvent.click(block);
  expect(screen.getByTestId('frame-line')).toHaveTextContent(new RegExp(`^frame ${id} ·`));
});

it('an errored feed shows its error text and no column', () => {
  const sunrise: SoloFeedState = { server: undefined, projected: undefined, error: 'boom' };
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={sunrise} sunset={stateOf('sunset')} />);
  expect(screen.getByText('boom')).toBeInTheDocument();
  expect(screen.queryByText(/Sunrise · left screen/)).toBeNull();
  expect(screen.getByText(/Sunset · right screen/)).toBeInTheDocument();
});

it('a feed with no error yet shows the loading line', () => {
  const sunrise: SoloFeedState = { server: undefined, projected: undefined, error: undefined };
  render(<SoloPanel version={SOLO_VERSIONS.solo} liveDials={D} nowMs={5_000} sunrise={sunrise} sunset={stateOf('sunset')} />);
  expect(screen.getByText('loading sunrise…')).toBeInTheDocument();
});
