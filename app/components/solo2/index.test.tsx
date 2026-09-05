import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Solo2Kiosk } from './index';

const entry = (id: number, capturedAt: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const glass = { current: entry(3, 300), next: null, slot: 1, boundaryMs: 0, error: null, queueLength: 1,
  nextEntries: [], entries: [entry(1, 100), entry(2, 200), entry(3, 300)] };
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: vi.fn(() => glass) }));
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(20_000)); // boundaryMs 0 with dwell 20 s → the dwell began at −20 s: elapsed 40 s, main stage
});
afterEach(() => vi.useRealTimers());

it('asks the glass hook for solo2, drives by default, follows in a preview', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'solo2', drive: true, dozing: false }));
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});

it('draws the current frame with the caption once the dwell is in its hold', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByText('t3')).toBeInTheDocument();
});

it('with the prelude dial on and the dwell just begun, shows the earlier frame from the same camera', () => {
  vi.setSystemTime(new Date(-19_500)); // 0.5 s into the dwell that began at −20 s
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ prelude: true, preludeFrames: 2 }} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u1');
  expect(screen.queryByText('t3')).toBeNull();
});
