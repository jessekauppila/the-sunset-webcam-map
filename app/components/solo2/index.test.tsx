import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Solo2Kiosk } from './index';

const entry = (id: number, capturedAt: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const entries = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8)];
const glass = { current: entry(3, 300), shownSince: null as number | null, next: null, slot: 1, boundaryMs: 0, error: null, queueLength: 1,
  nextEntries: [], entries };
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: vi.fn(() => glass) }));
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
const mocked = vi.mocked(useSoloGlass);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(20_000)); // boundaryMs 0 with dwell 20 s → the dwell began at −20 s: elapsed 40 s, last frame
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
  vi.setSystemTime(new Date(-19_500)); // 0.5 s into the dwell that began at −20 s
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
  mocked.mockImplementation(() => ({ ...glass, shownSince: 0 }));
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ transition: 'crossfade' }} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u1', 'u2', 'u3']);
  // Camera 8 goes on glass at 20 s.
  mocked.mockImplementation(() => ({ ...glass, current: entry(9, 250, 8), shownSince: 20_000, boundaryMs: 40_000 }));
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ transition: 'crossfade' }} />);
  // The previous frame (camera 7's drawn frame) sits underneath and the crossfade is on the stack, from the first render.
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3', 'u9']);
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 1.5s ease both' });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u9');
});

it('a follower whose boundary ticks past without a new frame keeps its dwell clock', () => {
  mocked.mockImplementation(() => ({ ...glass, shownSince: null, boundaryMs: 20_000 })); // dwell began at 0; now 20 s: last frame
  const { rerender } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  vi.setSystemTime(new Date(21_000));
  mocked.mockImplementation(() => ({ ...glass, shownSince: null, boundaryMs: 40_000 })); // the tick moved the boundary, not the frame
  rerender(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3'); // not back to u1
});
