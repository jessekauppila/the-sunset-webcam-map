import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { Solo2Kiosk } from './index';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const loaded = { current: entry(3), shownSince: 0, next: null, slot: 1, endsAtMs: 20_000, boundaryMs: 20_000,
  error: null, queueLength: 0, nextEntries: [], entries: [entry(3)], shownSnapshotIds: [3], dials: D, panelPreset: 'dell-l' };
const empty = { ...loaded, current: null, entries: [], shownSnapshotIds: [], dials: null, panelPreset: null };
const useGlassFollower = vi.fn(() => loaded);
vi.mock('./useGlassFollower', () => ({ useGlassFollower: (feed: string) => useGlassFollower(feed) }));
const useSoloGlass = vi.fn();
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: () => useSoloGlass() }));

beforeEach(() => {
  vi.clearAllMocks();
  useGlassFollower.mockReturnValue(loaded);
});

it('follows its feed through the projection and draws the screen with the projection\'s dials', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ cameraRun: false }} />);
  expect(useGlassFollower).toHaveBeenCalledWith('sunset');
  expect(useSoloGlass).not.toHaveBeenCalled();
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('is black until the first projection arrives', () => {
  useGlassFollower.mockReturnValue(empty);
  const { container } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.queryByTestId('top')).toBeNull();
  expect((container.firstChild as HTMLElement).style.background).toBe('rgb(0, 0, 0)');
});

it('ignores dozing and driveSchedule: nothing on this surface advances, so there is nothing to gate', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunrise" dozing driveSchedule={false} />);
  expect(useGlassFollower).toHaveBeenCalledWith('sunrise');
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});
