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
  mode: 'cut', order: 'none', durationMs: 900, spreadMs: 0, waveGridMs: 0,
  transition: 'dissolve', fadeMs: 900, fadeScale: 0.85, gapPx: 0,
};

/**
 * Drives the render loop synchronously, capped so a still-animating component
 * cannot spin the test forever. Returns the frame count so a test can assert
 * the loop parked itself.
 */
function stubRaf(maxFrames = 4, base = 1000) {
  let n = 0;
  let total = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (n >= maxFrames) return 0;
    n += 1;
    total += 1;
    cb(base + total * 16);
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
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = stubRaf(2, 1000);
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
    // The entry (fadeMs 900) is over by now; the retarget below is travel.
    now.mockReturnValue(2000);
    stubRaf(2, 2000);
    void raf;

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

/**
 * v4: change is scheduled, not immediate. The effect stamps each new frame
 * with `now + delay` from the motion layer; the draw loop promotes it when
 * the loop's clock reaches that stamp. performance.now() is pinned at 0 in
 * these tests so the effect's clock and the stubbed rAF clock agree.
 */
describe('MosaicCanvas — scheduled change', () => {
  // sweep on panel slot 1: the tile at x=10,w=100 on a 300px panel has
  // key (1 + 0.2) / 2 = 0.6, so with a 10s spread its delay is 6000ms.
  const SWEEP: MotionConfig = { ...CUT, order: 'sweep', spreadMs: 10_000 };
  const drawn = (ctx: CanvasRenderingContext2D) =>
    (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

  it('does not begin a frame crossfade before its delay', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    stubRaf(4, 1000); // loop clock well before 6000
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    expect(drawn(ctx)).toContain(oldImg);
    expect(drawn(ctx)).not.toContain(newImg);
  });

  it('a newer frame arriving before the pending one begins replaces it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    stubRaf(4, 1000);
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;
    const third = { id: 'third' } as unknown as HTMLImageElement;

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    // Now let the loop's clock pass the 6000ms stamp.
    stubRaf(4, 6000);
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(third)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    expect(drawn(ctx)).toContain(third);
    expect(drawn(ctx)).not.toContain(newImg);
  });

  it('applies a zero-delay frame at once, exactly as v3 did', () => {
    stubRaf();
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;
    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={CUT} crossfadeMs={0} panelSlot={0} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={CUT} crossfadeMs={0} panelSlot={0} />
    );
    expect(drawn(ctx)).toContain(newImg);
  });

  it('keeps drawing a departed tile\'s last frame while it fades out', () => {
    // v3 forgot the image the moment the tile left byId, so its exit fade
    // drew nothing and departures popped.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = stubRaf(2, 1000);
    const ctx = stubContext();
    const img = { id: 'last' } as unknown as HTMLImageElement;
    const tween: MotionConfig = { ...CUT, mode: 'tween', fadeMs: 5_000 };
    const empty: Layout = { ...layout(), tiles: [] };

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(img)} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={0} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    raf.reset();
    rerender(
      <MosaicCanvas layout={empty} byId={new Map()} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={0} />
    );
    expect(drawn(ctx)).toContain(img);
  });

  it('sleeps on a timer until the next scheduled change instead of spinning', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const raf = stubRaf(8, 1000);
    stubContext();
    const tween: MotionConfig = { ...CUT, mode: 'tween', order: 'sweep', spreadMs: 10_000, fadeMs: 100 };

    // The tile's entry is scheduled at 6000ms. The first draw runs at 1016,
    // finds nothing moving, and must arm one timer for 6000 - 1016 = 4984ms
    // rather than requesting frame after frame until then.
    render(
      <MosaicCanvas layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={1} />
    );
    expect(raf.count()).toBe(1);
    expect(setTimeoutSpy.mock.calls.some((c) => c[1] === 4984)).toBe(true);
  });
});
