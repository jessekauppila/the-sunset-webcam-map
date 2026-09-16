import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { PANEL_GAP_FRACTION, PIECE_MARGIN_FRACTION } from './pieceLayout';
import { PiecePage } from './PiecePage';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number) => ({
  snapshotId: id, webcamId: id, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, credit: null,
  stage: { kind: 'inLine' as const, position: null },
});
const NOW = 1_000_000_000_000;
const viewFor = (feed: 'sunrise' | 'sunset', id: number, panelPreset = 'dell-l') => ({
  feed, version: 'solo2', panelPreset, dials: D, slot: 4, build: 'b1',
  current: { entry: entry(id), shownSince: NOW - 19_000, slot: 4, endsAtMs: NOW + 1_000, shownSnapshotIds: [id] },
  entries: [entry(id)], next: [],
});

const VIEWPORT = { width: 1024, height: 768 }; // jsdom's default window
let calls: { url: string; method: string }[];
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });
const px = (el: HTMLElement, prop: 'width' | 'height') => Number.parseFloat(el.style[prop]);

function stubFetch(preset = 'dell-l') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const feed = url.includes('sunrise') ? 'sunrise' : 'sunset';
    return { ok: true, json: async () => viewFor(feed, feed === 'sunrise' ? 11 : 22, preset) };
  }));
}

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  window.history.replaceState({}, '', '/mirror?debug=1&panel=ktc');
  vi.stubGlobal('Image', class { set src(_v: string) { /* preload */ } });
  stubFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PiecePage', () => {
  it('is black before either projection has landed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* never settles */ })));
    render(<PiecePage />);
    await flush();
    expect(screen.getByTestId('mirror-dark')).toBeInTheDocument();
    expect(screen.queryByTestId('piece')).toBeNull();
  });

  it('shows the live half rather than blacking out the piece when ONE feed never answers', async () => {
    // The gallery in this state has one screen lit and one dark. Holding the
    // whole page black would be a worse lie than a dark half — and it would
    // hide a working screen behind a broken one indefinitely.
    let resolveSunset: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const feed = url.includes('sunrise') ? 'sunrise' : 'sunset';
      if (feed === 'sunset') await new Promise<void>((r) => { resolveSunset = r; });
      return { ok: true, json: async () => viewFor(feed, feed === 'sunrise' ? 11 : 22) };
    }));

    render(<PiecePage />);
    await flush();

    // Sunrise has landed; sunset has not. The piece is up, both panels hold
    // their place in the pair, and only the waiting one is empty.
    expect(screen.getByTestId('piece')).toBeInTheDocument();
    expect(screen.getByTestId('piece-panel-sunrise')).toBeInTheDocument();
    expect(screen.getByTestId('piece-panel-sunset')).toBeInTheDocument();
    expect(screen.getAllByTestId('top').map((i) => i.getAttribute('src'))).toEqual(['u11']);

    // And it fills in on its own when the slow feed finally answers.
    await act(async () => { resolveSunset?.(); await vi.advanceTimersByTimeAsync(5); });
    expect(screen.getAllByTestId('top').map((i) => i.getAttribute('src'))).toEqual(['u11', 'u22']);
  });

  it('keeps the pair geometry from the feed that did answer, so the live half is not resized', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('sunrise')) return new Promise(() => { /* sunset never answers */ });
      return { ok: true, json: async () => viewFor('sunrise', 11) };
    }));

    render(<PiecePage />);
    await flush();
    const left = screen.getByTestId('piece-panel-sunrise');
    const right = screen.getByTestId('piece-panel-sunset');
    expect(px(left, 'width')).toBeCloseTo(px(right, 'width'), 6);
    expect(screen.getByTestId('piece-stage-sunrise').style.width).toBe('1920px');
  });

  it('draws sunrise left and sunset right, each showing its own feed', async () => {
    render(<PiecePage />);
    await flush();

    const panels = screen.getAllByTestId(/^piece-panel-/);
    expect(panels.map((p) => p.dataset.testid ?? p.getAttribute('data-testid')))
      .toEqual(['piece-panel-sunrise', 'piece-panel-sunset']);
    const images = screen.getAllByTestId('top').map((i) => i.getAttribute('src'));
    expect(images).toEqual(['u11', 'u22']);
  });

  it('composes both panels at the live panel size', async () => {
    render(<PiecePage />);
    await flush();
    for (const feed of ['sunrise', 'sunset']) {
      const stage = screen.getByTestId(`piece-stage-${feed}`);
      expect(stage.style.width).toBe('1920px');
      expect(stage.style.height).toBe('1080px');
    }
  });

  it('scales both panels by the SAME factor, so neither picture is larger than the other', async () => {
    render(<PiecePage />);
    await flush();
    const left = screen.getByTestId('piece-panel-sunrise');
    const right = screen.getByTestId('piece-panel-sunset');

    expect(px(left, 'width')).toBeCloseTo(px(right, 'width'), 6);
    expect(px(left, 'height')).toBeCloseTo(px(right, 'height'), 6);
    expect(px(left, 'width')).toBeGreaterThan(0);
  });

  it('fits inside the window with a margin on every side, and keeps a seam between the pictures', async () => {
    render(<PiecePage />);
    await flush();
    const piece = screen.getByTestId('piece');
    const panelWidth = px(screen.getByTestId('piece-panel-sunrise'), 'width');
    const margin = Math.min(VIEWPORT.width, VIEWPORT.height) * PIECE_MARGIN_FRACTION;

    expect(px(piece, 'width')).toBeLessThanOrEqual(VIEWPORT.width - margin * 2 + 0.001);
    expect(px(piece, 'height')).toBeLessThanOrEqual(VIEWPORT.height - margin * 2 + 0.001);
    // A seam, present and proportional — not the wall's 6.2%.
    const gap = Number.parseFloat(piece.style.gap);
    expect(gap).toBeGreaterThan(0);
    expect(gap / panelWidth).toBeCloseTo(PANEL_GAP_FRACTION, 6);
  });

  it('follows both feeds and never drives either: only the projection, only GET', async () => {
    render(<PiecePage />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });

    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.url === '/api/mirror/state?feed=sunrise')).toBe(true);
    expect(calls.some((c) => c.url === '/api/mirror/state?feed=sunset')).toBe(true);
    const allowed = new Set(['/api/mirror/state?feed=sunrise', '/api/mirror/state?feed=sunset']);
    expect(calls.every((c) => allowed.has(c.url))).toBe(true);
  });

  it('reads no query parameters: no debug overlay with ?debug=1, and the live preset wins over ?panel=', async () => {
    render(<PiecePage />);
    await flush();
    expect(screen.queryByText(/slot 4/)).toBeNull();
    expect(screen.getByTestId('piece-stage-sunrise').style.width).toBe('1920px');
  });

  it('falls back to the default preset when the live one is a name this build does not know', async () => {
    stubFetch('panel-from-the-future');
    render(<PiecePage />);
    await flush();
    expect(screen.getByTestId('piece-stage-sunrise').style.width).toBe('1080px');
    expect(screen.getByTestId('piece-stage-sunset').style.height).toBe('1920px');
  });
});
