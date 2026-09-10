import { it, expect, beforeAll, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';

/**
 * What the preview PAINTS across a change of dwell, render by render.
 *
 * Every other assertion about the preview reads the DOM after `act`, which
 * flushes passive effects — so they see where a render SETTLES, never what the
 * browser actually put on screen. The flash Jesse reported lived exactly in
 * that gap: one committed frame showing a later picture of the new run,
 * corrected by an effect before any existing test could look.
 *
 * So this file records `Solo2Frame`'s props on every render instead. A render
 * is a paint's worth of truth, and the picture a render puts up is fixed by
 * `stage.index` clamped to the run — the same line the component uses.
 */
const painted: { top: string | undefined; index: number; dwellKey: unknown }[] = [];

vi.mock('@/app/components/solo2/Solo2Frame', () => ({
  Solo2Frame: (p: { run: EntryView[]; entry: EntryView; stage: { index: number }; dwellKey?: unknown }) => {
    const seq = p.run.length > 0 ? p.run : [p.entry];
    const shown = Math.min(p.stage.index, seq.length - 1);
    painted.push({ top: seq[shown]?.imageUrl, index: p.stage.index, dwellKey: p.dwellKey });
    return <div data-testid="frame" />;
  },
}));

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

const entry = {
  snapshotId: 7, webcamId: 1, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 1, enteredAt: 0,
  imageUrl: 'u7', title: 'Porjus', city: 'Porjus', region: 'Norrbotten County', country: 'Sweden',
  eligible: true, rank: 1, capturedAt: Date.UTC(2026, 8, 5, 18, 46), timezone: 'Europe/Stockholm', sunAltitudeDeg: null,
};
const at = (id: number, webcamId: number, capturedAt = entry.capturedAt) => ({
  ...entry, snapshotId: id, webcamId, imageUrl: `u${id}`, capturedAt,
});
const server = { current: { entry, shownSince: 0, slot: 1 } } as unknown as StateView;

it('paints the new run from its OLDEST frame, with no later picture in between', async () => {
  const { GlassPreview } = await import('./GlassPreview');
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  vi.useFakeTimers();
  const d2 = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), dwellS: 6, sameCameraFadeS: 1, minStepS: 1, dwellBoost: 0, dwellTrim: 0 };
  // BOTH cameras need a multi-frame run. The outgoing dwell's stage index is
  // what gets stranded, so a camera on glass with a run of ONE ends at index 0
  // and strands nothing — the fixture, not the code, is what decides whether
  // this bug can appear at all.
  const cam1a = at(5, 1, entry.capturedAt - 20 * 60_000);
  const cam1b = at(6, 1, entry.capturedAt - 10 * 60_000);
  const cam2a = at(11, 2, entry.capturedAt - 30 * 60_000);
  const cam2b = at(12, 2, entry.capturedAt - 20 * 60_000);
  const cam2c = at(13, 2, entry.capturedAt - 10 * 60_000);
  const s2 = { ...server, entries: [cam1a, cam1b, entry, cam2a, cam2b, cam2c] } as unknown as StateView;
  const projected = { next: [cam2c] } as unknown as StateView;

  painted.length = 0;
  render(<GlassPreview version={SOLO_VERSIONS.solo2} screens={[{ feed: 'sunset', server: s2, projected }]}
    dials={d2} panel={{ width: 1920, height: 1080 }} />);
  const firstKey = painted[0].dwellKey;
  expect(painted[0].top).toBe('u5'); // camera 1's run opens on its oldest

  await act(async () => { vi.advanceTimersByTime(8_100); }); // past camera 1's whole dwell

  // Every render belonging to the NEW dwell, in order. The first of them is
  // the one the browser paints when the change lands.
  const newDwell = painted.filter((p) => p.dwellKey !== firstKey);
  expect(newDwell.length).toBeGreaterThan(0);
  // Before the fix this recorded ['u5', 'u13' @ index 2, 'u11'] — the middle
  // one is the flash, camera 2's NEWEST picture painted from camera 1's
  // stranded index, exactly the "lighter frame further into the day" Jesse
  // saw at the head of a sunrise run.
  expect(newDwell[0]).toMatchObject({ top: 'u11', index: 0 });
});
