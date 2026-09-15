import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ARRIVAL_EASES } from '@/app/lib/solo2/veil';
import * as planModule from '@/app/lib/solo2/plan';
import { render, screen, act } from '@testing-library/react';
import { Solo2Kiosk } from './index';

const entry = (id: number, capturedAt: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const entries = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8)];
// The server always stamps shown-since for a frame on glass, and publishes
// the dwell's end as an instant beside it (spec §5.1). A client never works
// a start backwards from an end and a dial, which a budget makes wrong.
//
// An empty `shownSnapshotIds` is a screen row from before the dwell was
// pinned, so these fixtures exercise the fallback derivation. The pinned path
// has its own tests at the foot of this file.
const glass = { current: entry(3, 300), shownSince: 0 as number | null, next: null, slot: 1,
  endsAtMs: 20_000 as number | null, boundaryMs: 20_000, error: null, queueLength: 1,
  nextEntries: [], entries, shownSnapshotIds: [] as number[] };
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: vi.fn(() => glass) }));
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
const mocked = vi.mocked(useSoloGlass);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(20_000)); // the dwell began at 0: 20 s elapsed, so the run is on its last frame
  mocked.mockImplementation(() => glass);
});
afterEach(() => vi.useRealTimers());

it('asks the glass hook for solo2, drives by default, follows in a preview', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'solo2', drive: true, dozing: false }));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});

it('late in the dwell, draws the drawn frame with its caption', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  // The screen name no longer prefixes the title: the time line names the
  // crossing instead, and only once it has actually happened.
  expect(screen.getByTestId('caption-title')).toHaveTextContent('t3');
});

it('at the start of the dwell, the camera run begins at its oldest frame', () => {
  vi.setSystemTime(new Date(500)); // 0.5 s into the dwell that began at 0
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u1');
  expect(screen.getByTestId('caption-title')).toHaveTextContent('t1');
  expect(screen.queryByText('t3')).toBeNull();
});

it('with the camera run off, the dwell is the drawn frame alone', () => {
  vi.setSystemTime(new Date(-19_500));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ cameraRun: false }} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('the dwell clock starts at the server\'s shown-since, so a follower joins the run in the right place', () => {
  // 8.5 s in: the 1.5 s arrival segment, then 7 s into the run = frame 2 of 3 (6.67 s each)
  mocked.mockImplementation(() => ({ ...glass, shownSince: 11_500, boundaryMs: 40_000 }));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('a new frame on glass arrives with the old one as its previous in the same render, and restarts the clock', () => {
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ transition: 'crossfade' }} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u1', 'u2', 'u3']);
  // Camera 8 goes on glass at 20 s.
  mocked.mockImplementation(() => ({ ...glass, current: entry(9, 250, 8), shownSince: 20_000, endsAtMs: 40_000, boundaryMs: 40_000 }));
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ transition: 'crossfade' }} />);
  // The previous frame (camera 7's drawn frame) sits underneath and the crossfade is on the stack, from the first render.
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3', 'u9']);
  // Camera 7 → camera 8 is a camera change, not a same-camera step, so the
  // fade is the change beat's fadeS (changeBeats × beat = 1 × 4 s = 4 s),
  // not sameCameraFadeS (1.5 s).
  expect(screen.getByTestId('stack'))
    .toHaveStyle({ animation: `solo2-fade-in 4s ${ARRIVAL_EASES.gentle} both` });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u9');
});

it('a follower whose published end moves without a new frame keeps its dwell clock', () => {
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  vi.setSystemTime(new Date(21_000));
  // The server extended this dwell — under a budget an end can move without
  // the frame changing. The clock is keyed on the START, so the run does not
  // jump back to its first frame.
  mocked.mockImplementation(() => ({ ...glass, endsAtMs: 40_000, boundaryMs: 40_000 }));
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
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
  mocked.mockImplementation(() => pinned);
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
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
  mocked.mockImplementation(() => ({ ...pinned, endsAtMs: 62_000, boundaryMs: 62_000 }));
  vi.setSystemTime(new Date(8_500));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('does not step backwards when the pool grows under a running dwell', () => {
  // The bug of 2026-09-08. A re-derivation reads the frame cap as a rank
  // among the sunsets present, and a wider cap admits more of the window
  // `runOf` builds around the camera's peak — so every index can shift. Here
  // camera 8 weakens, which lifts camera 7 to the top of the ranking and
  // would widen its run from three frames to four, putting u0 at the front.
  vi.setSystemTime(new Date(8_500));
  mocked.mockImplementation(() => pinned);
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');

  const grown = [entry(0, 50), entry(1, 100), entry(2, 200), entry(3, 300), { ...entry(9, 250, 8), quality: 0.1 }];
  mocked.mockImplementation(() => ({ ...pinned, entries: grown }));
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  // Same picture, same second: the run is fact from the draw, not a re-read.
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
});

it('a frame the pool dropped mid-dwell costs its picture, never the step rate', () => {
  // u2 is gone from the pool but keeps its place in the timing, so the frames
  // that remain still change on the beat the published end was sized for.
  vi.setSystemTime(new Date(14_000)); // frame 3 of 3
  mocked.mockImplementation(() => ({ ...pinned, entries: [entry(1, 100), entry(3, 300)] }));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('a pinned dwell reads its rest from the published span, not a re-rank of a moving pool', () => {
  // One pinned frame, a 20 s span (5 beats at beatS 4): dwellBeats input =
  // 5 − 1 change = 4, restBeats = 4 − 1 = 3, total = 1 + 1 + 3 = 5 beats × 4 s = 20 s.
  const oneFrame = { ...glass, shownSnapshotIds: [3], shownSince: 0, endsAtMs: 20_000, boundaryMs: 20_000 };
  mocked.mockImplementation(() => oneFrame);
  const spy = vi.spyOn(planModule, 'fitPlan');
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(spy.mock.results.at(-1)?.value.dwellS).toBe(20);
  spy.mockClear();
  // A state refresh returns a pool where camera 8 now outranks camera 7 —
  // under the old re-derivation (`planDialsFor` ranked against `glass.entries`
  // on every render) this would move `dwellBeats`/`restBeats` under a running
  // clock even though the pinned frame count never changed (2026-09-14).
  const stronger = [entry(1, 100), entry(2, 200), { ...entry(3, 300), quality: 0.9 }, { ...entry(9, 250, 8), quality: 0.99 }];
  mocked.mockImplementation(() => ({ ...oneFrame, entries: stronger }));
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
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
  mocked.mockImplementation(() => threePinned);
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  const stackBefore = screen.getByTestId('stack');

  // The grow: two more frames of the same run, the published end 8 s later,
  // the slot and the dwell's start untouched.
  const fivePinned = { ...threePinned, shownSnapshotIds: [1, 2, 3, 4, 5], endsAtMs: 24_000, boundaryMs: 24_000 };
  mocked.mockImplementation(() => fivePinned);
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('stack')).toBe(stackBefore); // no remount

  act(() => { vi.advanceTimersByTime(17_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u4'); // the 4th pinned frame, index 3
});
