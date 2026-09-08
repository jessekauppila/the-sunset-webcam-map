import { it, expect, beforeAll, vi, afterEach } from 'vitest';
import { ARRIVAL_EASES } from '@/app/lib/solo2/veil';
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
    dials={{ ...D, titleClean: 'spot', timeStyle: '12h-there' }} panel={{ width: 1920, height: 1080 }} />);
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

it('draws the panel edge on the panel and leaves the preview column unbordered', () => {
  render(<GlassPreview screens={[{ feed: 'sunrise', server, projected: null }]} dials={D} panel={{ width: 1920, height: 1080 }} />);
  // The line the eye judges the caption against must be the panel's, not the
  // column's: the column is 480 x 270 here and the panel scales to 480 x 270
  // only because they happen to share an aspect. A portrait panel in this
  // column would leave black margins, and a border on the column would sit
  // where the glass has nothing.
  expect(screen.getByTestId('studio-panel-edge').style.boxShadow).toBe('inset 0 0 0 1px #f5a344');
  expect(screen.getByTestId('preview-sunrise').style.border).toBe('');
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
  // 3 frames → 2 s each, after the 1.5 s arrival segment the default dip adds
  // at the front of every solo2 dwell (dwell-budget spec §3.3): 7.5 s a dwell.
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1, minStepS: 1, dwellBoost: 0, dwellTrim: 0 };
  const older = (id: number, capturedAt: number) => ({ ...entry, snapshotId: id, imageUrl: `u${id}`, capturedAt });
  const entries = [older(5, entry.capturedAt - 20 * 60_000), older(6, entry.capturedAt - 10 * 60_000), entry];
  const s2 = { ...server, entries } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected: null }]} dials={d2} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5');
  expect(screen.getByTestId('seq-1'))
    .toHaveStyle({ opacity: '0', transition: `opacity 1s ${ARRIVAL_EASES.gentle}` });
  await act(async () => { vi.advanceTimersByTime(3_600); }); // 1.5 s arrival + 2.1 s: the second frame is up
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
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1, minStepS: 1, dwellBoost: 0, dwellTrim: 0 };
  const cam2a = at(11, 2, entry.capturedAt - 30 * 60_000);
  const cam2b = at(12, 2, entry.capturedAt - 20 * 60_000);
  const s2 = { ...server, entries: [entry, cam2a, cam2b] } as unknown as StateView;
  const projected = { next: [cam2b] } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected }]}
    dials={d2} panel={{ width: 1920, height: 1080 }} />);
  // The on-glass frame is camera 1's only frame: a run of one.
  expect(screen.queryByTestId('seq-1')).toBeNull();

  await act(async () => { vi.advanceTimersByTime(7_600); }); // past the 6 s budget plus the 1.5 s arrival
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
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1, minStepS: 1, dwellBoost: 0, dwellTrim: 0 }; // 2 frames → 3 s each, after a 1.5 s arrival
  const panel = { width: 1920, height: 1080 };
  const camAOlder = at(5, 1, entry.capturedAt - 20 * 60_000);
  const s2a = { current: { entry, shownSince: 0, slot: 1 }, entries: [camAOlder, entry] } as unknown as StateView;
  const { rerender } = render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2a, projected: null }]}
    dials={d2} panel={panel} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5'); // run's first frame at mount

  await act(async () => { vi.advanceTimersByTime(5_000); }); // past the arrival and the 3 s step, still inside the 7.5 s dwell (index 0 unchanged)
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

// The reported bug: at the end of a run the preview "fades up to an earlier
// image". A run restarting inside a mounted stack lowers `shown`, and the
// layers above it carry an opacity transition, so they dissolve away and
// reveal the oldest frame underneath instead of the run simply beginning
// again. A dwell must therefore rebuild its stack, not fade back down it —
// including when the preview replays the very same drawn frame, which is what
// it does whenever there is no projected queue.
it('a run restarts by rebuilding its stack, never by fading back down to an earlier frame', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  vi.useFakeTimers();
  // minStepS 2 keeps the 6 s dwell divided evenly by 3 rather than stretched,
  // so this test is about the stack and not about the budget.
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, minStepS: 2, sameCameraFadeS: 1, dwellBoost: 0, dwellTrim: 0 }; // 3 frames → 2 s each, after a 1.5 s arrival
  const older = (id: number, capturedAt: number) => ({ ...entry, snapshotId: id, imageUrl: `u${id}`, capturedAt });
  const entries = [older(5, entry.capturedAt - 20 * 60_000), older(6, entry.capturedAt - 10 * 60_000), entry];
  const s2 = { ...server, entries } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected: null }]}
    dials={d2} panel={{ width: 1920, height: 1080 }} />);

  await act(async () => { vi.advanceTimersByTime(5_600); }); // 1.5 s arrival + 4.1 s
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u7'); // last frame of the run
  const stackBefore = screen.getByTestId('stack');

  await act(async () => { vi.advanceTimersByTime(2_000); }); // the dwell ends and replays
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u5'); // back to the oldest frame
  // Rebuilt, so the later frames are simply gone rather than dissolving away
  // on top of the oldest one.
  expect(screen.getByTestId('stack')).not.toBe(stackBefore);
});

it('plays the queue when the glass is dark, and never calls a queued frame `on glass now`', async () => {
  vi.useFakeTimers();
  // `current` is null whenever the on-glass frame has aged out of the pool
  // (view.ts resolves it by id against the live entries), which is the state
  // a screen sits in whenever nothing is advancing it. The queue is fine.
  const dark = { current: null, entries: [] } as unknown as StateView;
  const projected = { next: [at(8, 2), at(9, 3)] } as unknown as StateView;
  const { container } = render(<GlassPreview screens={[{ feed: 'sunrise', server: dark, projected }]}
    dials={{ ...D, dwellS: 4 }} panel={{ width: 1920, height: 1080 }} />);

  expect(screen.queryByText('no frame to preview')).toBeNull();
  expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['u8']);
  // The glass really is dark, so the status says so rather than claiming the queue is on it.
  expect(screen.getByText(/^nothing on glass · preview · frame 8 · next in \d+ s$/)).toBeInTheDocument();

  await act(async () => { vi.advanceTimersByTime(4_100); });
  expect(screen.getByText(/^nothing on glass · preview · frame 9/)).toBeInTheDocument();
});

it('a screen with neither a frame on glass nor a queue still says it has nothing to draw', () => {
  const dark = { current: null, entries: [] } as unknown as StateView;
  render(<GlassPreview screens={[{ feed: 'sunrise', server: dark, projected: { next: [] } as unknown as StateView }]}
    dials={D} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByText('no frame to preview')).toBeInTheDocument();
  expect(screen.getByText('nothing on glass')).toBeInTheDocument();
});

it('solo2 holds a stretched dwell for the run it plays, not for the dial', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  vi.useFakeTimers();
  // 3 frames against a 3 s floor: the budget cannot divide 6 s that finely, so
  // the dwell STRETCHES to 9 s (dwell-budget spec §3). The walker has to wait
  // for the run it is actually playing.
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, minStepS: 3, sameCameraFadeS: 1 };
  const older = (id: number, capturedAt: number) => ({ ...entry, snapshotId: id, imageUrl: `u${id}`, capturedAt });
  const entries = [older(5, entry.capturedAt - 20 * 60_000), older(6, entry.capturedAt - 10 * 60_000), entry];
  const s2 = { ...server, entries } as unknown as StateView;
  const projected = { next: [at(8, 2)] } as unknown as StateView;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected }]}
    dials={d2} panel={{ width: 1920, height: 1080 }} />);

  await act(async () => { vi.advanceTimersByTime(7_600); }); // the dial (plus the 1.5 s arrival) is up; the run is not
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u7'); // still the run's last frame
  expect(screen.getByText(/on glass now · frame 7/)).toBeInTheDocument();

  await act(async () => { vi.advanceTimersByTime(3_000); }); // 10.5 s: the arrival and the 9 s run are done
  expect(screen.getByText(/^preview · frame 8/)).toBeInTheDocument();
});
