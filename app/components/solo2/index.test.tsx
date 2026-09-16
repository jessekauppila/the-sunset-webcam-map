import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Solo2Kiosk } from './index';

const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const glass = { current: entry(3), shownSince: 0, next: null, slot: 1, endsAtMs: 20_000, boundaryMs: 20_000,
  error: null, queueLength: 1, nextEntries: [], entries: [entry(3)], shownSnapshotIds: [3] };
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: vi.fn(() => glass) }));
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';

it('asks the glass hook for solo2, drives by default, follows in a preview, and draws the screen', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'solo2', drive: true, dozing: false }));
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});
