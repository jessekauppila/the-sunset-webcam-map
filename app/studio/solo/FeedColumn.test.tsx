import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedColumn } from './FeedColumn';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { buildStateView, type ViewEntry } from '@/app/api/kiosk/solo/view';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number, bin: 'sunset' | 'non_sunset', score: number, webcamId = 100 + id): ViewEntry => ({
  snapshotId: id, webcamId, bin, quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally: 0, enteredAt: id, imageUrl: `u${id}`, title: `cam${id}`, city: '', region: '', country: '',
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});
const view = (dials = D) => buildStateView({
  feed: 'sunset', dials,
  entries: [entry(1, 'sunset', 0.9), entry(2, 'sunset', 0.8, 101), entry(3, 'non_sunset', 0.5), entry(4, 'sunset', 0.1)],
  screen: { feed: 'sunset', currentSnapshotId: 1, shownSince: 0, slot: 0, sunsetStreak: 1 },
  nowMs: 0, admitted: { sunset: 1, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 },
});

it('draws the on-glass frame at the top of the queue and keeps queued frames out of the bins', () => {
  const v = view();
  render(<FeedColumn feed="sunset" server={v} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  // Sunset boundaries sit at 10 s, 30 s, … (offset 10): at 5 s the next is 5 s away.
  expect(screen.getByText(/next frame in/).textContent).toContain('5 s');
  expect(screen.getByText(/Sunset bin · 1 waiting/)).toBeInTheDocument(); // frame 4 (below floor) waits
  expect(screen.getAllByText('cam1').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/CAM 1\/2/).length).toBeGreaterThan(0); // frames 1 and 2 share webcam 101
});

it('says so when the studio dials would draw a different next frame than the glass', () => {
  const server = view();
  const projected = view({ ...D, qualityFloor: 0.05, repeatAllowance: 0, sunsetFloor: 0 });
  // With frame 4 admitted and shown frames sinking, the projection's first draw
  // differs from the server's only if the two first entries disagree; assert on
  // the message when they do, and on its absence when they do not, so the test
  // documents the rule rather than a coincidence.
  const expectMessage = server.next[0].snapshotId !== projected.next[0].snapshotId;
  render(<FeedColumn feed="sunset" server={server} projected={projected} liveDials={D} studioDials={D} nowMs={0} onSelect={vi.fn()} />);
  if (expectMessage) expect(screen.getByText(/projected with studio dials/)).toBeInTheDocument();
  else expect(screen.queryByText(/projected with studio dials/)).toBeNull();
});

it('with nothing on glass the panel says so and the queue starts at the projection', () => {
  const v = buildStateView({ feed: 'sunrise', dials: D, entries: [entry(9, 'sunset', 0.9)], screen: null, nowMs: 0,
    admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 } });
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={D} studioDials={D} nowMs={0} onSelect={vi.fn()} />);
  expect(screen.getByText('nothing on glass yet')).toBeInTheDocument();
  expect(screen.getAllByText('cam9').length).toBeGreaterThan(0);
});
