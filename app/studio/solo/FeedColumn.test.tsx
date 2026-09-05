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

it('solo2 with valleys tags queued draws PEAK and VALLEY and captions the local time', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), valleys: 1 };
  const at = Date.UTC(2026, 8, 5, 2, 42);
  const es = [entry(1, 'sunset', 0.9), entry(2, 'sunset', 0.8), entry(3, 'sunset', 0.7)]
    .map((e) => ({ ...e, capturedAt: at, timezone: 'America/Mazatlan', region: 'BCS', country: 'Mexico' }));
  const v = buildStateView({ feed: 'sunrise', dials: d2, entries: es,
    screen: { feed: 'sunrise', currentSnapshotId: 1, shownSince: 0, slot: 0, sunsetStreak: 1 },
    nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 }, version: SOLO_VERSIONS.solo2 });
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={d2} studioDials={d2} nowMs={0} version={SOLO_VERSIONS.solo2} onSelect={vi.fn()} />);
  expect(screen.getAllByText('VALLEY').length).toBeGreaterThan(0);
  expect(screen.getAllByText('PEAK').length).toBeGreaterThan(0);
  expect(screen.getByText('BCS, Mexico · 7:42 pm there')).toBeInTheDocument();
});

it('solo2 with the prelude on groups a camera\'s earlier frames under the queued draw and flags their own later turns', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), prelude: true, preludeFrames: 3, repeatAllowance: 0 };
  const at = Date.UTC(2026, 8, 5, 2, 42);
  const cam = (id: number, score: number, minutesBefore: number) => ({
    ...entry(id, 'sunset', score, 7), capturedAt: at - minutesBefore * 60_000, timezone: 'America/Mazatlan',
  });
  // Camera 7 has three frames; the best (3) is on glass with 1 and 2 as its prelude. Camera 9 is alone.
  const es = [cam(1, 0.6, 44), cam(2, 0.7, 28), cam(3, 0.9, 0), { ...entry(4, 'sunset', 0.8, 9), capturedAt: at, timezone: 'America/Mazatlan' }];
  const v = buildStateView({ feed: 'sunrise', dials: d2, entries: es,
    screen: { feed: 'sunrise', currentSnapshotId: 3, shownSince: 0, slot: 0, sunsetStreak: 1 },
    nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 }, version: SOLO_VERSIONS.solo2 });
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={d2} studioDials={d2} nowMs={0} version={SOLO_VERSIONS.solo2} onSelect={vi.fn()} />);
  // The on-glass row is a group whose earlier frames read 6:58 pm then 7:14 pm.
  const groups = screen.getAllByRole('group');
  expect(groups.length).toBeGreaterThan(0);
  expect(groups[0]).toHaveTextContent(/6:58 pm.*7:14 pm.*cam3/s);
  // Frames 1 and 2 still get their own turn somewhere later, flagged.
  expect(screen.getAllByText('PRELUDE').length).toBeGreaterThan(0);
});
