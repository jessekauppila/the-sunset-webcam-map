import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
const glass = { current: entry(3, 300), shownSince: 0 as number | null, next: null, slot: 1,
  endsAtMs: 20_000 as number | null, boundaryMs: 20_000, error: null, queueLength: 1,
  nextEntries: [], entries };
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

it('late in the dwell, draws the drawn frame with its caption and the screen name', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Sunset: t3');
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
  mocked.mockImplementation(() => ({ ...glass, shownSince: 13_000, boundaryMs: 40_000 })); // 7 s in: frame 2 of 3 (6.67 s each)
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
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 1.5s linear both' });
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
