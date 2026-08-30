import { vi } from 'vitest';

// jsdom has no real Image loader — auto-fire onload with fixed naturals so
// useLoadedTiles resolves synchronously-ish (via microtask) in tests. A src
// containing 'bad' fires onerror instead, so tests can exercise the
// skipped-load path.
class FakeImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  naturalWidth = 712;
  naturalHeight = 400;
  set src(v: string) {
    if (v.includes('bad')) {
      queueMicrotask(() => this.onerror?.());
    } else {
      queueMicrotask(() => this.onload?.());
    }
  }
}
vi.stubGlobal('Image', FakeImage);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  render,
  renderHook,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { GeoMosaic } from './GeoMosaic';
import { useLoadedTiles } from './useLoadedTiles';
import { compose } from './engine/compose';
import { COMPOSITION_CONFIG } from './config';
import type { WindyWebcam } from '@/app/lib/types';
import type { TileInput } from './engine/types';

function makeWebcam(
  id: number,
  lat: number,
  lng: number,
  score: number
): WindyWebcam {
  return {
    webcamId: id,
    title: `Cam ${id}`,
    viewCount: 0,
    status: 'active',
    images: {
      current: { preview: `https://example.com/${id}.jpg` },
    },
    location: { latitude: lat, longitude: lng },
    categories: [],
    aiRatingRegression: score,
  } as unknown as WindyWebcam;
}

const webcams: WindyWebcam[] = [
  makeWebcam(1, 40, -20, 5),
  makeWebcam(2, -10, 60, 3),
  makeWebcam(3, 20, 100, 1),
];

interface FakeCtx {
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  resetTransform: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  fillStyle: string;
}

let ctx: FakeCtx;

beforeEach(() => {
  ctx = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    scale: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    fillStyle: '#000000',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GeoMosaic', () => {
  it('renders a canvas', async () => {
    const { container } = render(
      <GeoMosaic webcams={webcams} width={800} height={600} feed="sunset" />
    );
    expect(container.querySelector('canvas')).toBeTruthy();
    await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());
  });

  it('shows the feed label and tile/dropped/skipped counter in setup mode', async () => {
    render(
      <GeoMosaic
        webcams={webcams}
        width={800}
        height={600}
        feed="sunset"
        setupMode
      />
    );

    await waitFor(() => expect(screen.getByText('SUNSET')).toBeInTheDocument());
    expect(
      screen.getByText(/tiles · .* dropped · .* skipped/)
    ).toBeInTheDocument();
  });

  it('does not flash the empty-state feed label while images are still loading', async () => {
    render(
      <GeoMosaic webcams={webcams} width={800} height={600} feed="sunset" />
    );

    // Synchronously right after mount, useLoadedTiles has announced a new
    // load cycle (loading: true) but the FakeImage loads haven't resolved
    // yet (they fire on a later microtask) — layout.tiles is still empty
    // at this instant. The dim empty-state label must not flash on here.
    expect(screen.queryByText('SUNSET')).not.toBeInTheDocument();

    // Let the in-flight FakeImage microtasks settle before the test ends,
    // so their state updates don't leak into the next test outside act().
    await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());
  });

  it('renders no overlay text outside setup mode', async () => {
    render(
      <GeoMosaic webcams={webcams} width={800} height={600} feed="sunset" />
    );

    await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

    expect(screen.queryByText('SUNSET')).not.toBeInTheDocument();
    expect(screen.queryByText('THIS WAY UP')).not.toBeInTheDocument();
  });

  it('fires onSelect with the matching webcam when clicking inside a placed tile', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <GeoMosaic
        webcams={webcams}
        width={800}
        height={600}
        feed="sunset"
        onSelect={onSelect}
      />
    );

    await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

    // Independently compose the same inputs to find a tile's screen-space
    // center + the webcam it belongs to.
    const tiles: TileInput[] = webcams.map((w) => ({
      id: w.webcamId,
      lat: w.location.latitude,
      lng: w.location.longitude,
      srcWidth: 712,
      srcHeight: 400,
      score: (w as unknown as { aiRatingRegression: number }).aiRatingRegression,
    }));
    const layout = compose(
      tiles,
      { width: 800, height: 600 },
      COMPOSITION_CONFIG
    );
    expect(layout.tiles.length).toBeGreaterThan(0);
    const target = layout.tiles[0];
    const targetWebcam = webcams.find((w) => w.webcamId === target.id)!;

    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(canvas, {
      clientX: target.x + target.width / 2,
      clientY: target.y + target.height / 2,
    });

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(targetWebcam));
  });

  it('counts a failed image load as skipped and reflects it in the overlay counter', async () => {
    const webcamsWithOneBad: WindyWebcam[] = [
      makeWebcam(1, 40, -20, 5),
      { ...makeWebcam(2, -10, 60, 3), images: { current: { preview: 'https://example.com/bad.jpg' } } },
      makeWebcam(3, 20, 100, 1),
    ];

    render(
      <GeoMosaic
        webcams={webcamsWithOneBad}
        width={800}
        height={600}
        feed="sunset"
        setupMode
      />
    );

    const counterEl = await waitFor(() =>
      screen.getByText(/skipped/)
    );
    const match = counterEl.textContent!.match(
      /(\d+) tiles · (\d+) dropped · (\d+) skipped/
    );
    expect(match).toBeTruthy();
    const [, tilesStr, droppedStr, skippedStr] = match!;
    // Exactly 1 of the 3 webcams failed to load (the 'bad' one).
    expect(Number(skippedStr)).toBe(1);
    // The 2 successfully loaded webcams are each either placed or dropped
    // by the composition engine's overflow handling — either way they're
    // accounted for.
    expect(Number(tilesStr) + Number(droppedStr)).toBe(2);
  });
});

describe('useLoadedTiles', () => {
  it('reports loading: true while images are in flight, then false once settled', async () => {
    const { result } = renderHook(() => useLoadedTiles(webcams));

    // The effect kicks off a new load cycle synchronously; image loads
    // themselves resolve on a later microtask, so loading must already be
    // true immediately after mount.
    expect(result.current.loading).toBe(true);
    expect(result.current.tiles).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tiles.length).toBe(webcams.length);
    expect(result.current.skipped).toBe(0);
  });

  it('counts webcams with no preview URL into skipped', async () => {
    const webcamsWithMissingPreview: WindyWebcam[] = [
      ...webcams,
      { ...makeWebcam(4, 5, 5, 2), images: { current: {} } } as WindyWebcam,
    ];

    const { result } = renderHook(() =>
      useLoadedTiles(webcamsWithMissingPreview)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tiles.length).toBe(webcams.length);
    expect(result.current.skipped).toBe(1);
  });

  it('reports skipped for a no-preview pool immediately, without an in-flight load', () => {
    const noPreviewWebcams: WindyWebcam[] = [
      { ...makeWebcam(9, 1, 1, 1), images: { current: {} } } as WindyWebcam,
    ];

    const { result } = renderHook(() => useLoadedTiles(noPreviewWebcams));

    expect(result.current.loading).toBe(false);
    expect(result.current.tiles).toEqual([]);
    expect(result.current.skipped).toBe(1);
  });
});
