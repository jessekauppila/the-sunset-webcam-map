import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { MirrorPage, panelFor } from './MirrorPage';
import { PANEL_PRESETS, DEFAULT_PANEL_PRESET } from '@/app/kiosk/panelPreview';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, credit: null,
  stage: { kind: 'inLine' as const, position: null },
});
const NOW = 1_000_000_000_000;
const view = {
  feed: 'sunset', version: 'solo2', panelPreset: 'dell-l', dials: D, slot: 4, build: 'b1',
  current: { entry: entry(3), shownSince: NOW - 19_000, slot: 4, endsAtMs: NOW + 1_000, shownSnapshotIds: [3] },
  entries: [entry(3)], next: [],
};
let calls: { url: string; method: string }[];
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  window.history.replaceState({}, '', '/sunset?debug=1&v=v1&panel=ktc');
  vi.stubGlobal('Image', class { set src(_v: string) { /* preload */ } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: true, json: async () => view };
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('panelFor', () => {
  it('resolves a known preset', () => {
    expect(panelFor('ktc-l')).toEqual(PANEL_PRESETS['ktc-l']);
  });

  it('falls back for null, empty, and unknown names', () => {
    for (const bad of [null, '', 'panel-from-the-future']) {
      expect(panelFor(bad)).toEqual(PANEL_PRESETS[DEFAULT_PANEL_PRESET]);
    }
  });

  it('falls back for inherited Object keys rather than returning a function', () => {
    // A bare index would hand back Object.prototype.constructor here, which is
    // truthy — so `?? default` would not fire and panel.width would be
    // undefined, scaling the stage to NaN and drawing nothing silently.
    for (const inherited of ['constructor', 'toString', 'valueOf', '__proto__']) {
      const panel = panelFor(inherited);
      expect(panel).toEqual(PANEL_PRESETS[DEFAULT_PANEL_PRESET]);
      expect(Number.isFinite(panel.width)).toBe(true);
      expect(Number.isFinite(panel.height)).toBe(true);
    }
  });
});

describe('MirrorPage', () => {
  it('is black before the first projection', async () => {
    render(<MirrorPage feed="sunset" />);
    expect(screen.getByTestId('mirror-dark')).toBeInTheDocument();
    expect(screen.queryByTestId('top')).toBeNull();
    // Settle the in-flight projection so it does not land after teardown.
    await flush();
  });

  it("renders the glass's composition at the live panel size, scaled into the window", async () => {
    render(<MirrorPage feed="sunset" />);
    await flush();
    expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
    const stage = screen.getByTestId('panel-stage');
    expect(stage.style.width).toBe('1920px');
    expect(stage.style.height).toBe('1080px');
  });

  it('reads no query parameters: no debug overlay with ?debug=1, and the live preset wins over ?panel=', async () => {
    render(<MirrorPage feed="sunset" />);
    await flush();
    expect(screen.queryByText(/slot 4/)).toBeNull();
    expect(screen.getByTestId('panel-stage').style.width).toBe('1920px');
  });

  it('talks only to the projection, only with GET', async () => {
    render(<MirrorPage feed="sunrise" />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.every((c) => c.url === '/api/mirror/state?feed=sunrise')).toBe(true);
    for (const banned of ['/api/kiosk/state', '/api/kiosk/tick', '/api/kiosk/solo/state', '/api/kiosk/solo/advance']) {
      expect(calls.some((c) => c.url.includes(banned))).toBe(false);
    }
  });

  it('stays black and keeps asking while the projection is answering 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return { ok: false, status: 503, json: async () => ({ error: 'mirror unavailable' }) };
    }));

    render(<MirrorPage feed="sunset" />);
    await flush();
    expect(screen.getByTestId('mirror-dark')).toBeInTheDocument();

    // It must not give up: the 503 is cacheable and short-lived, so the page
    // has to be there on its own when the store comes back.
    const before = calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('falls back to the default preset when the live one is a name this build does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...view, panelPreset: 'panel-from-the-future' }) })));
    render(<MirrorPage feed="sunset" />);
    await flush();
    // dell, the pinned default: a preset the build cannot resolve must not
    // collapse the stage to zero and paint nothing.
    expect(screen.getByTestId('panel-stage').style.width).toBe('1080px');
    expect(screen.getByTestId('panel-stage').style.height).toBe('1920px');
  });
});
