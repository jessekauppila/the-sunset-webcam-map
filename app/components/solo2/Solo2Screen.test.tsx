import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ARRIVAL_EASES } from '@/app/lib/solo2/veil';
import * as planModule from '@/app/lib/solo2/plan';
import { render, screen, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Screen } from './Solo2Screen';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number, capturedAt: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const entries = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8)];
const glass: SoloGlass = { current: entry(3, 300), shownSince: 0, next: null, slot: 1,
  endsAtMs: 20_000, boundaryMs: 20_000, error: null, queueLength: 1,
  nextEntries: [], entries, shownSnapshotIds: [] };
const draw = (g: SoloGlass, dials = D) =>
  render(<Solo2Screen glass={g} dials={dials} width={100} height={50} feed="sunset" />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(20_000)); // the dwell began at 0: 20 s elapsed, so the run is on its last frame
});
afterEach(() => vi.useRealTimers());

it('late in the dwell, draws the drawn frame with its caption', () => {
  draw(glass);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  // The screen name no longer prefixes the title: the time line names the
  // crossing instead, and only once it has actually happened.
  expect(screen.getByTestId('caption-title')).toHaveTextContent('t3');
});

it('at the start of the dwell, the camera run begins at its oldest frame', () => {
  vi.setSystemTime(new Date(500)); // 0.5 s into the dwell that began at 0
  draw(glass);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u1');
  expect(screen.getByTestId('caption-title')).toHaveTextContent('t1');
  expect(screen.queryByText('t3')).toBeNull();
});

it('with the camera run off, the dwell is the drawn frame alone', () => {
  vi.setSystemTime(new Date(-19_500));
  draw(glass, { ...D, cameraRun: false });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('the dwell clock starts at the server\'s shown-since, so a follower joins the run in the right place', () => {
  // 8.5 s in: the 1.5 s arrival segment, then 7 s into the run = frame 2 of 3 (6.67 s each)
  draw({ ...glass, shownSince: 11_500, boundaryMs: 40_000 });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('a new frame on glass arrives with the old one as its previous in the same render, and restarts the clock', () => {
  const fade = { ...D, transition: 'crossfade' as const };
  const { rerender } = render(<Solo2Screen glass={glass} dials={fade} width={100} height={50} feed="sunset" />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u1', 'u2', 'u3']);
  // Camera 8 goes on glass at 20 s.
  rerender(<Solo2Screen glass={{ ...glass, current: entry(9, 250, 8), shownSince: 20_000, endsAtMs: 40_000, boundaryMs: 40_000 }} dials={fade} width={100} height={50} feed="sunset" />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3', 'u9']);
  expect(screen.getByTestId('stack'))
    .toHaveStyle({ animation: `solo2-fade-in 4s ${ARRIVAL_EASES.gentle} both` });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u9');
});

it('a follower whose published end moves without a new frame keeps its dwell clock', () => {
  const { rerender } = draw(glass);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  vi.setSystemTime(new Date(21_000));
  // The server extended this dwell — under a budget an end can move without
  // the frame changing. The clock is keyed on the START, so the run does not
  // jump back to its first frame.
  rerender(<Solo2Screen glass={{ ...glass, endsAtMs: 40_000, boundaryMs: 40_000 }} dials={D} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3'); // not back to u1
});

// The pinned dwell (2026-09-08). The draw decides the run and the span; the
// glass plays them. Before this, both were re-derived from `entries` on every
// render, and `entries` is refetched every minute from a pool that changes
// every minute.
const PINNED = [1, 2, 3];
const pinned = { ...glass, shownSnapshotIds: PINNED, shownSince: 0, endsAtMs: 20_000, boundaryMs: 20_000 };

it('plays the frames the draw pinned, in the order it pinned them', () => {
  // 20 s span, 1.5 s arrival, 3 frames: 6.17 s each. 8.5 s in is frame 2.
  vi.setSystemTime(new Date(8_500));
  draw(pinned);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('steps on the beat, not the span the server happens to publish', () => {
  // Under the beat model the dwell is computed purely from the dials and the
  // pinned frame count (`fitPlan`) — `endsAtMs`/`boundaryMs` no longer sizes
  // the step, so stretching the published end to 62 s changes nothing here.
  // Camera 7 and camera 8 tie on quality (both 0.9), so camera 7's rank is 0
  // and its still budget is 3 × (1 − 0.25 trim + 0 boost) = 2.25 → 2 beats;
  // 3 pinned frames already exceed that budget, so the rest is 0 and the
  // dwell is 1 change beat + 3 frames = 4 beats × 4 s = 16 s, whatever
  // endsAtMs says. Arrival is 1 beat (4 s); 8.5 s in is 4.5 s into the run,
  // floor(4.5 / 4) = 1 → the second pinned frame.
  vi.setSystemTime(new Date(8_500));
  draw({ ...pinned, endsAtMs: 62_000, boundaryMs: 62_000 });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('does not step backwards when the pool grows under a running dwell', () => {
  // The bug of 2026-09-08. A re-derivation reads the frame cap as a rank
  // among the sunsets present, and a wider cap admits more of the window
  // `runOf` builds around the camera's peak — so every index can shift. Here
  // camera 8 weakens, which lifts camera 7 to the top of the ranking and
  // would widen its run from three frames to four, putting u0 at the front.
  vi.setSystemTime(new Date(8_500));
  const { rerender } = draw(pinned);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');

  const grown = [entry(0, 50), entry(1, 100), entry(2, 200), entry(3, 300), { ...entry(9, 250, 8), quality: 0.1 }];
  rerender(<Solo2Screen glass={{ ...pinned, entries: grown }} dials={D} width={100} height={50} feed="sunset" />);
  // Same picture, same second: the run is fact from the draw, not a re-read.
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('a frame the pool dropped mid-dwell costs its picture, never the step rate', () => {
  // u2 is gone from the pool but keeps its place in the timing, so the frames
  // that remain still change on the beat the published end was sized for.
  vi.setSystemTime(new Date(14_000)); // frame 3 of 3
  draw({ ...pinned, entries: [entry(1, 100), entry(3, 300)] });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('a pinned dwell reads its rest from the published span, not a re-rank of a moving pool', () => {
  // One pinned frame, a 20 s span (5 beats at beatS 4): dwellBeats input =
  // 5 − 1 change = 4, restBeats = 4 − 1 = 3, total = 1 + 1 + 3 = 5 beats × 4 s = 20 s.
  const oneFrame = { ...glass, shownSnapshotIds: [3], shownSince: 0, endsAtMs: 20_000, boundaryMs: 20_000 };
  const spy = vi.spyOn(planModule, 'fitPlan');
  const { rerender } = draw(oneFrame);
  expect(spy.mock.results.at(-1)?.value.dwellS).toBe(20);
  spy.mockClear();
  // A state refresh returns a pool where camera 8 now outranks camera 7 —
  // under the old re-derivation (`planDialsFor` ranked against `glass.entries`
  // on every render) this would move `dwellBeats`/`restBeats` under a running
  // clock even though the pinned frame count never changed (2026-09-14).
  const stronger = [entry(1, 100), entry(2, 200), { ...entry(3, 300), quality: 0.9 }, { ...entry(9, 250, 8), quality: 0.99 }];
  rerender(<Solo2Screen glass={{ ...oneFrame, entries: stronger }} dials={D} width={100} height={50} feed="sunset" />);
  expect(spy.mock.results.at(-1)?.value.dwellS).toBe(20);
  spy.mockRestore();
});

// The grown dwell (rendezvous spec §3, task 8): the ending run plays more of
// its own camera and the slot never moves, so `shownSince` — the dwell key —
// is unchanged. The stack must not remount, and the plan re-fits from the
// wider span so the step continues past the frames that were already up.
it('a grown dwell keeps the stack mounted and steps into the added frames', () => {
  const growable = [entry(1, 100), entry(2, 200), entry(3, 300), entry(4, 400), entry(5, 500)];
  vi.setSystemTime(new Date(0));
  const threePinned = {
    ...glass, entries: growable, shownSnapshotIds: [1, 2, 3], shownSince: 0, endsAtMs: 16_000, boundaryMs: 16_000,
  };
  const { rerender } = draw(threePinned);
  const stackBefore = screen.getByTestId('stack');

  // The grow: two more frames of the same run, the published end 8 s later,
  // the slot and the dwell's start untouched.
  const fivePinned = { ...threePinned, shownSnapshotIds: [1, 2, 3, 4, 5], endsAtMs: 24_000, boundaryMs: 24_000 };
  rerender(<Solo2Screen glass={fivePinned} dials={D} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('stack')).toBe(stackBefore); // no remount

  act(() => { vi.advanceTimersByTime(17_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u4'); // the 4th pinned frame, index 3
});
