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
  render(<GlassPreview screens={[{ feed: 'sunrise', server, projected: null }, { feed: 'sunset', server: null, projected: null }]}
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
  render(<GlassPreview screens={[{ feed: 'sunrise', server, projected: null }, { feed: 'sunset', server, projected: null }]} dials={D} panel={{ width: 1920, height: 1080 }} />);
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
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected: null }]} dials={d2} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5');
  expect(screen.getByTestId('seq-1')).toHaveStyle({ opacity: '0', transition: 'opacity 1s linear' });
  await act(async () => { vi.advanceTimersByTime(2_100); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u6');
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u7');
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5'); // round again
});

// The queue the preview walks: the on-glass frame, then the STUDIO projection.
const at = (id: number, webcamId: number, capturedAt = entry.capturedAt) => ({
  ...entry, snapshotId: id, webcamId, imageUrl: `u${id}`, capturedAt,
});

it('walks the projected queue on the studio dwell, crossfading from the frame it replaces', async () => {
  vi.useFakeTimers();
  const projected = { next: [at(8, 2), at(9, 3)] } as unknown as StateView;
  const { container } = render(<GlassPreview screens={[{ feed: 'sunset', server, projected }]}
    dials={{ ...D, dwellS: 4, fadeS: 2 }} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByText('on glass now · frame 7')).toBeInTheDocument();

  await act(async () => { vi.advanceTimersByTime(4_100); });
  expect(screen.getByText(/^preview · frame 8 · next in \d+ s$/)).toBeInTheDocument();
  // The frame it replaced sits underneath, and the top layer carries the studio's fade dial.
  const imgs = [...container.querySelectorAll('img')];
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['u7', 'u8']);
  expect(imgs[1]).toHaveStyle({ transition: 'opacity 2s ease' });

  await act(async () => { vi.advanceTimersByTime(4_000); });
  expect(screen.getByText(/^preview · frame 9/)).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(4_000); });
  expect(screen.getByText('on glass now · frame 7')).toBeInTheDocument(); // wraps to the glass frame
});

it('solo2 plays the queued dwell\'s own camera run once the preview advances', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  vi.useFakeTimers();
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1 };
  const cam2a = at(11, 2, entry.capturedAt - 30 * 60_000);
  const cam2b = at(12, 2, entry.capturedAt - 20 * 60_000);
  const s2 = { ...server, entries: [entry, cam2a, cam2b] } as unknown as StateView;
  const projected = { next: [cam2b] } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected }]}
    dials={d2} panel={{ width: 1920, height: 1080 }} />);
  // The on-glass frame is camera 1's only frame: a run of one.
  expect(screen.queryByTestId('seq-1')).toBeNull();

  await act(async () => { vi.advanceTimersByTime(6_100); });
  expect(screen.getByText(/^preview · frame 12/)).toBeInTheDocument();
  // Camera 2's run: 11 then 12, and the stage clock restarted with the step.
  expect(screen.getByTestId('seq-1')).toBeInTheDocument();
  expect(screen.queryByTestId('seq-2')).toBeNull();
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u11');
});

it('restarts at the on-glass frame when the server advances', async () => {
  vi.useFakeTimers();
  const projected = { next: [at(8, 2)] } as unknown as StateView;
  const dials = { ...D, dwellS: 4 };
  const panel = { width: 1920, height: 1080 };
  const { rerender } = render(<GlassPreview screens={[{ feed: 'sunset', server, projected }]} dials={dials} panel={panel} />);
  await act(async () => { vi.advanceTimersByTime(4_100); });
  expect(screen.getByText(/^preview · frame 8/)).toBeInTheDocument();

  const advanced = { current: { entry: at(21, 4), shownSince: 0, slot: 2 } } as unknown as StateView;
  rerender(<GlassPreview screens={[{ feed: 'sunset', server: advanced, projected }]} dials={dials} panel={panel} />);
  expect(screen.getByText('on glass now · frame 21')).toBeInTheDocument();
});

it('restarts the run\'s stage clock when the server advances a different camera while still at index 0 (keyed on the dwell start, not the index)', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  vi.useFakeTimers();
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1 }; // 2 frames → 3 s each
  const panel = { width: 1920, height: 1080 };
  const camAOlder = at(5, 1, entry.capturedAt - 20 * 60_000);
  const s2a = { current: { entry, shownSince: 0, slot: 1 }, entries: [camAOlder, entry] } as unknown as StateView;
  const { rerender } = render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2a, projected: null }]}
    dials={d2} panel={panel} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5'); // run's first frame at mount

  await act(async () => { vi.advanceTimersByTime(4_000); }); // past the 3 s step, still inside the 6 s dwell (index 0 unchanged)
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u7'); // stage advanced within the same dwell

  // The server advances to a different camera while the preview is still
  // sitting at index 0: the dwell restarts (index 0 → 0, unchanged) with a
  // new startMs. If the stage clock were still keyed on the index, it would
  // not restart and would show a frame computed from the stale clock instead
  // of the new run's first frame.
  const camB = at(21, 4, entry.capturedAt);
  const camBOlder = at(20, 4, entry.capturedAt - 10 * 60_000);
  const s2b = { current: { entry: camB, shownSince: 0, slot: 2 }, entries: [camBOlder, camB] } as unknown as StateView;
  rerender(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2b, projected: null }]}
    dials={d2} panel={panel} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u20'); // camera B's run, first frame — the stage restarted
});
