import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MosaicCanvas } from './MosaicCanvas';
import type { Layout } from './engine/types';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = { webcamId: 1, title: 'c' } as WindyWebcam;

const layout = (): Layout => ({
  tiles: [
    {
      id: 1, lat: 0, lng: 0, srcWidth: 400, srcHeight: 300,
      passes: true, score: 0.5, sunAltitudeDeg: -13,
      width: 100, height: 75, pinnedToFloor: false, x: 10, y: 20,
    },
  ],
  dropped: [],
  scale: 1,
  viewport: { width: 300, height: 500 },
});

const byId = () =>
  new Map([[1, { img: {} as HTMLImageElement, webcam }]]);

describe('MosaicCanvas', () => {
  it('draws every placed tile at its position', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      resetTransform: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
      drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    render(<MosaicCanvas layout={layout()} byId={byId()} width={300} height={500} />);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 10, 20, 100, 75);
    vi.restoreAllMocks();
  });

  it('never reads pixels back — the canvas is tainted by design', () => {
    const getImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      resetTransform: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
      drawImage: vi.fn(), getImageData, imageSmoothingEnabled: false,
      imageSmoothingQuality: '', fillStyle: '',
    } as unknown as CanvasRenderingContext2D);

    render(<MosaicCanvas layout={layout()} byId={byId()} width={300} height={500} />);
    expect(getImageData).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
