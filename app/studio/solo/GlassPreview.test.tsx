import { it, expect, beforeAll, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GlassPreview } from './GlassPreview';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { StateView } from '@/app/api/kiosk/solo/view';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = {
  snapshotId: 7, webcamId: 1, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 1, enteredAt: 0,
  imageUrl: 'u7', title: 'Porjus › North-west: Northern Lights webcam', city: 'Porjus', region: 'Norrbotten County', country: 'Sweden',
  eligible: true, rank: 1, capturedAt: Date.UTC(2026, 8, 5, 18, 46), timezone: 'Europe/Stockholm', sunAltitudeDeg: null,
};
const server = { current: { entry, shownSince: 0, slot: 1 } } as unknown as StateView;

// jsdom has no ResizeObserver; StudioPanelFrame needs one to size its stage.
// Report a 480 × 270 box the instant it observes, so the effect resolves in render.
beforeAll(() => {
  class Stub {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 480, height: 270 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = Stub;
});

it('draws each screen\'s current frame at the panel\'s true pixels with the studio dials, and says when a screen has nothing', () => {
  render(<GlassPreview screens={[{ feed: 'sunrise', server }, { feed: 'sunset', server: null }]}
    dials={{ ...D, titleClean: 'spot' }} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Northern Lights webcam');
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Porjus, Norrbotten County, Sweden');
  expect(screen.getByTestId('caption-time')).toHaveTextContent('8:46 pm there');
  expect(screen.getByText(/on glass now · frame 7/)).toBeInTheDocument();
  expect(screen.getByText('sunrise · left screen')).toBeInTheDocument();
  expect(screen.getByText('no frame to preview')).toBeInTheDocument();
  expect(screen.getAllByText('1920 × 1080')).toHaveLength(2);
  // Composed at glass size, scaled to the box: 480 / 1920 = 0.25.
  const stage = screen.getByTestId('studio-panel-stage');
  expect(stage).toHaveStyle({ width: '1920px', height: '1080px', transform: 'scale(0.25)' });
});

it('names the screen before the title on each preview', () => {
  render(<GlassPreview screens={[{ feed: 'sunrise', server }, { feed: 'sunset', server }]} dials={D} panel={{ width: 1920, height: 1080 }} />);
  const titles = screen.getAllByTestId('caption-title').map((t) => t.textContent);
  expect(titles[0]).toMatch(/^Sunrise: /);
  expect(titles[1]).toMatch(/^Sunset: /);
});

afterEach(() => vi.useRealTimers());

it('solo2 plays the on-glass camera\'s run on the studio dials, looping on a local clock, with the dissolve between frames', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const { schemaDefaults } = await import('@/app/lib/settings/schema');
  vi.useFakeTimers();
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1 }; // 3 frames → 2 s each
  const older = (id: number, capturedAt: number) => ({ ...entry, snapshotId: id, imageUrl: `u${id}`, capturedAt });
  const entries = [older(5, entry.capturedAt - 20 * 60_000), older(6, entry.capturedAt - 10 * 60_000), entry];
  const s2 = { ...server, entries } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2 }]} dials={d2} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5');
  expect(screen.getByTestId('seq-1')).toHaveStyle({ opacity: '0', transition: 'opacity 1s linear' });
  await act(async () => { vi.advanceTimersByTime(2_100); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u6');
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u7');
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5'); // round again
});
