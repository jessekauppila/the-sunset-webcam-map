import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedColumn } from './FeedColumn';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { buildStateView, type ViewEntry } from '@/app/api/kiosk/solo/view';

const D = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), ratingFloor: 3.2 }; // quality 0.55: frame 4 (0.1) is below it
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
  expect(screen.getAllByText('cam2').length).toBeGreaterThan(0); // solo: frames 1 and 2 share webcam 101 and are still two rows
  expect(screen.queryByRole('group')).toBeNull();
});

it('each bin is three labelled stages with counts, even when a stage is empty', () => {
  const v = view();
  render(<FeedColumn feed="sunset" server={v} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  // Frame 4 (rating 1.4) is under the sunset floor; nothing rests; both bins render all three labels.
  expect(screen.getAllByText('IN LINE · 0')).toHaveLength(2);
  expect(screen.getAllByText('RESTING · 0')).toHaveLength(2);
  expect(screen.getByText('UNDER FLOOR · 1')).toBeInTheDocument();
  expect(screen.getByText('UNDER FLOOR · 0')).toBeInTheDocument();
  expect(screen.getByText('rating 1.4 < 3.2')).toBeInTheDocument();
  expect(screen.getByText(/^on glass · shown ×/)).toBeInTheDocument();
});

it('the tape sits under the heading and above the bins with the server past and the projected next, and the button folds it away', () => {
  const v = view();
  const past = { ...v.bins.sunset[0], snapshotId: 2, imageUrl: 'u2', title: 'cam2', slot: 1, shownAt: 0 };
  render(<FeedColumn feed="sunset" server={{ ...v, tape: [past] }} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  const tape = screen.getByTestId('tape');
  expect(screen.getByTestId('tape-past-2-1')).toBeInTheDocument();
  expect(screen.getByTestId('tape-current')).toBeInTheDocument();
  expect(screen.getByTestId('tape-next-0')).toBeInTheDocument();
  // The tape precedes the bins in document order.
  const binHeading = screen.getByText(/Sunset bin ·/);
  expect(tape.compareDocumentPosition(binHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /tape/ }));
  expect(screen.queryByTestId('tape')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /tape/ }));
  expect(screen.getByTestId('tape')).toBeInTheDocument();
});

it('says so when the studio dials would draw a different next frame than the glass', () => {
  const server = view();
  const projected = view({ ...D, ratingFloor: 1, rest: 0, sunsetFloor: 0 });
  // With frame 4 admitted and shown frames sinking, the projection's first draw
  // differs from the server's only if the two first entries disagree; assert on
  // the message when they do, and on its absence when they do not, so the test
  // documents the rule rather than a coincidence.
  const expectMessage = server.next[0].snapshotId !== projected.next[0].snapshotId;
  render(<FeedColumn feed="sunset" server={server} projected={projected} liveDials={D} studioDials={D} nowMs={0} onSelect={vi.fn()} />);
  if (expectMessage) expect(screen.getByText(/projected with studio dials/)).toBeInTheDocument();
  else expect(screen.queryByText(/projected with studio dials/)).toBeNull();
});

it('with nothing on glass the queue starts at the projection', () => {
  const v = buildStateView({ feed: 'sunrise', dials: D, entries: [entry(9, 'sunset', 0.9)], screen: null, nowMs: 0,
    admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 } });
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={D} studioDials={D} nowMs={0} onSelect={vi.fn()} />);
  expect(screen.getAllByText('cam9').length).toBeGreaterThan(0);
});

it('solo2 with valleys tags queued draws PEAK and VALLEY', async () => {
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
});

it('solo2 with the camera run on shows one box per camera, in the queue and in the bins, and hands a click its column', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), ratingFloor: 3.2 }; // quality 0.55
  const at = Date.UTC(2026, 8, 5, 2, 42);
  const cam = (id: number, webcamId: number, score: number, minutesBefore: number) => ({
    ...entry(id, 'sunset', score, webcamId), capturedAt: at - minutesBefore * 60_000, timezone: 'America/Mazatlan',
  });
  // Camera 7: frames 1, 2, 3 (3 newest, on glass). Camera 9: frames 4 and 5 (5 newest, in line). Camera 11: frame 6 alone, under the floor.
  const es = [cam(1, 7, 0.6, 44), cam(2, 7, 0.7, 28), cam(3, 7, 0.9, 0), cam(4, 9, 0.8, 30), cam(5, 9, 0.75, 10), cam(6, 11, 0.1, 5)];
  const v = buildStateView({ feed: 'sunrise', dials: d2, entries: es,
    screen: { feed: 'sunrise', currentSnapshotId: 3, shownSince: 0, slot: 0, sunsetStreak: 1 },
    nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 }, version: SOLO_VERSIONS.solo2 });
  const onSelect = vi.fn();
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={d2} studioDials={d2} nowMs={0} version={SOLO_VERSIONS.solo2} onSelect={onSelect} />);
  const groups = screen.getAllByRole('group');
  // The on-glass box is camera 7 oldest to newest with the count on the first picture; camera 9 is a box of two.
  expect(groups[0]).toHaveTextContent(/1\/3 · 6:58 pm.*2\/3 · 7:14 pm.*3\/3.*cam3/s);
  expect(screen.getAllByRole('group', { name: 'cam5: 2 frames in one dwell' })[0]).toHaveTextContent(/1\/2 · 7:12 pm.*cam5/s);
  // Frames 1 and 2 have no row of their own anywhere.
  expect(screen.queryByText('cam1')).toBeNull();
  expect(screen.queryByText('cam2')).toBeNull();
  expect(screen.queryByText('PRELUDE')).toBeNull();
  expect(screen.queryByText(/^CAM /)).toBeNull();
  // The sunset bin counts cameras: only 11 (under floor) waits; cameras 7 and 9 are in the queue.
  expect(screen.getByText(/Sunset bin · 1 waiting/)).toBeInTheDocument();
  expect(screen.getByText('UNDER FLOOR · 1')).toBeInTheDocument();
  // A click on an earlier frame reports it with its column's frames in play order.
  fireEvent.click(screen.getAllByTitle(/1 of 2 in this dwell/)[0]);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 4 }), 'sunrise',
    expect.arrayContaining([expect.objectContaining({ snapshotId: 1 }), expect.objectContaining({ snapshotId: 4 }), expect.objectContaining({ snapshotId: 5 })]));
});

it('solo2 with the camera run off lists every frame for itself', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: false };
  const es = [entry(1, 'sunset', 0.6, 7), entry(2, 'sunset', 0.9, 7)];
  const v = buildStateView({ feed: 'sunrise', dials: d2, entries: es, screen: null,
    nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 }, version: SOLO_VERSIONS.solo2 });
  render(<FeedColumn feed="sunrise" server={v} projected={v} liveDials={d2} studioDials={d2} nowMs={0} version={SOLO_VERSIONS.solo2} onSelect={vi.fn()} />);
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.getAllByText('cam1').length).toBeGreaterThan(0);
  expect(screen.getAllByText('cam2').length).toBeGreaterThan(0);
});
