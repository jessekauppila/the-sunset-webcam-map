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
