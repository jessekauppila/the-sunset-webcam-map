import { vi } from 'vitest';

// jsdom has no real Image loader — auto-fire onload with fixed naturals so
// useLoadedTiles resolves synchronously-ish (via microtask) in tests.
class FakeImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  naturalWidth = 712;
  naturalHeight = 400;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal('Image', FakeImage);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { GeoMosaic } from './GeoMosaic';
import { compose } from './engine/compose';
import { COMPOSITION_CONFIG } from '@/app/lib/masterConfig';
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
});
