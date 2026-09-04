import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MosaicCanvas } from './MosaicCanvas';
import type { Layout } from './engine/types';
import type { MotionConfig } from './motion';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = { webcamId: 1, title: 'c' } as WindyWebcam;

const layout = (x = 10): Layout => ({
  tiles: [
    {
      id: 1, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
      passes: true, score: 0.5, sunAltitudeDeg: -13,
      width: 100, height: 75, pinnedToFloor: false, x, y: 20,
    },
  ],
  dropped: [],
  scale: 1,
  viewport: { width: 300, height: 500 },
});

const byId = (img: HTMLImageElement) => new Map([[1, { img, webcam }]]);

const CUT: MotionConfig = {
  mode: 'cut', order: 'none', durationMs: 900, staggerMs: 0, waveGridMs: 0,
};

/**
 * Drives the render loop synchronously, capped so a still-animating component
 * cannot spin the test forever. Returns the frame count so a test can assert
 * the loop parked itself.
 */
function stubRaf(maxFrames = 4) {
  let n = 0;
  let total = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (n >= maxFrames) return 0;
    n += 1;
    total += 1;
    cb(1000 + total * 16);
    return n;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    count: () => total,
    /** Hand the loop a fresh budget, e.g. after a rerender. */
    reset: () => { n = 0; },
  };
}

function stubContext(over: Partial<CanvasRenderingContext2D> = {}) {
  const ctx = {
    resetTransform: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
    drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: '',
    fillStyle: '', globalAlpha: 1, ...over,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MosaicCanvas', () => {
  it('draws every placed tile at its position', () => {
    stubRaf();
    const ctx = stubContext();
    const img = {} as HTMLImageElement;

    render(
      <MosaicCanvas
        layout={layout()} byId={byId(img)} width={300} height={500}
        motion={CUT} crossfadeMs={0} panelSlot={0}
      />
    );
    expect(ctx.drawImage).toHaveBeenCalledWith(img, 10, 20, 100, 75);
  });

  it('never reads pixels back — the canvas is tainted by design', () => {
    stubRaf();
    const getImageData = vi.fn();
    stubContext({ getImageData } as Partial<CanvasRenderingContext2D>);

    render(
      <MosaicCanvas
        layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
        motion={CUT} crossfadeMs={0} panelSlot={0}
      />
    );
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('parks the render loop once nothing is moving', () => {
    // A kiosk sitting on a still composition must not hold a rAF loop open.
    const raf = stubRaf();
    stubContext();

    render(
      <MosaicCanvas
        layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
        motion={CUT} crossfadeMs={0} panelSlot={0}
      />
    );
    expect(raf.count()).toBe(1);
  });

  it('keeps drawing the old frame underneath while a new one fades up', () => {
    stubRaf();
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;

    const { rerender } = render(
      <MosaicCanvas
        layout={layout()} byId={byId(oldImg)} width={300} height={500}
        motion={CUT} crossfadeMs={800} panelSlot={0}
      />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();

    // Same camera, new preview: the tile must not pop straight to the new one.
    rerender(
      <MosaicCanvas
        layout={layout()} byId={byId(newImg)} width={300} height={500}
        motion={CUT} crossfadeMs={800} panelSlot={0}
      />
    );

    const drawn = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(drawn).toContain(oldImg);
    expect(drawn).toContain(newImg);
  });

  it('moves a tile toward its new place instead of jumping there', () => {
    const raf = stubRaf(2);
    const ctx = stubContext();
    const img = {} as HTMLImageElement;
    const tween: MotionConfig = { ...CUT, mode: 'tween', durationMs: 5_000 };

    const { rerender } = render(
      <MosaicCanvas
        layout={layout(0)} byId={byId(img)} width={300} height={500}
        motion={tween} crossfadeMs={0} panelSlot={0}
      />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    raf.reset();

    rerender(
      <MosaicCanvas
        layout={layout(250)} byId={byId(img)} width={300} height={500}
        motion={tween} crossfadeMs={0} panelSlot={0}
      />
    );

    const xs = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(250);
  });
});

/**
 * Click-to-detail. The canvas is CORS-tainted, so a hit cannot be read back
 * out of the pixels — the draw loop records each tile's rect as it paints,
 * and the click walks that list. v1 has had this covered since GeoMosaic;
 * v2 and v3 shipped the same handler with no test behind it.
 */
describe('MosaicCanvas tile clicks', () => {
  it('fires onSelect with the webcam whose tile was clicked', () => {
    stubRaf();
    stubContext();
    const onSelect = vi.fn();

    const { container } = render(
      <MosaicCanvas
        layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
        motion={CUT} crossfadeMs={0} panelSlot={0} onSelect={onSelect}
      />
    );

    // The only tile occupies x 10..110, y 20..95.
    fireEvent.click(container.querySelector('canvas')!, { clientX: 15, clientY: 25 });
    expect(onSelect).toHaveBeenCalledWith(webcam);
  });

  it('ignores a click that lands on no tile', () => {
    stubRaf();
    stubContext();
    const onSelect = vi.fn();

    const { container } = render(
      <MosaicCanvas
        layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
        motion={CUT} crossfadeMs={0} panelSlot={0} onSelect={onSelect}
      />
    );

    fireEvent.click(container.querySelector('canvas')!, { clientX: 250, clientY: 400 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
