import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelInfoOverlay } from './ModelInfoOverlay';
import type { Layout } from './engine/types';
import type { WindyWebcam } from '@/app/lib/types';

// Stored ratings are 1 + probability*4 (aiScoring.ts), so:
//   binary 4.32 -> p 0.83 (sunset at the 0.55 gate)
//   binary 1.36 -> p 0.09 (not a sunset)
function cam(id: number, overrides: Partial<WindyWebcam>): WindyWebcam {
  return {
    webcamId: id,
    viewCount: 0,
    location: { latitude: 0, longitude: 0 },
    ...overrides,
  } as WindyWebcam;
}

function tile(id: number): Layout['tiles'][number] {
  return {
    id,
    lat: 0,
    lng: 0,
    srcWidth: 400,
    srcHeight: 224,
    score: 3,
    percentile: 0.5,
    width: 178,
    height: 100,
    x: 0,
    y: (id - 1) * 110,
  };
}

function renderOverlay(webcams: WindyWebcam[]) {
  const layout: Layout = {
    tiles: webcams.map((w) => tile(w.webcamId as number)),
    dropped: [],
    viewport: { width: 1080, height: 1920 },
  };
  const byId = new Map(
    webcams.map((w) => [
      w.webcamId as number,
      { img: {} as HTMLImageElement, webcam: w },
    ])
  );
  return render(<ModelInfoOverlay layout={layout} byId={byId} />);
}

describe('ModelInfoOverlay', () => {
  it('shows the detection verdict with its probability', () => {
    renderOverlay([
      cam(1, { aiRatingBinary: 4.32, aiRatingRegression: 3.7 }),
    ]);
    expect(screen.getByText(/sunset · 83%/)).toBeDefined();
  });

  it('shows a below-gate verdict as "not a sunset"', () => {
    renderOverlay([
      cam(1, { aiRatingBinary: 1.36, aiRatingRegression: 2.1 }),
    ]);
    expect(screen.getByText(/not a sunset · 9%/)).toBeDefined();
  });

  it('shows the quality rating out of 5', () => {
    renderOverlay([
      cam(1, { aiRatingBinary: 4.32, aiRatingRegression: 3.7 }),
    ]);
    expect(screen.getByText(/3\.7\/5/)).toBeDefined();
  });

  it('annotates the quality line when detection gated the tile minimal', () => {
    renderOverlay([
      cam(1, { aiRatingBinary: 1.36, aiRatingRegression: 2.1 }),
    ]);
    expect(screen.getByText(/2\.1\/5 · gated/)).toBeDefined();
  });

  it('shows "not scored" instead of faking values for unstamped cams', () => {
    renderOverlay([cam(1, {})]);
    expect(screen.getByText(/not scored/)).toBeDefined();
  });

  it('renders one chip per placed tile, keyed to that tile\'s webcam', () => {
    renderOverlay([
      cam(1, { aiRatingBinary: 4.32, aiRatingRegression: 3.7 }),
      cam(2, { aiRatingBinary: 1.36, aiRatingRegression: 2.1 }),
    ]);
    expect(screen.getAllByTestId('model-chip')).toHaveLength(2);
  });

  it('skips tiles whose webcam is not in byId (image never resolved)', () => {
    const layout: Layout = {
      tiles: [tile(1)],
      dropped: [],
      viewport: { width: 1080, height: 1920 },
    };
    render(<ModelInfoOverlay layout={layout} byId={new Map()} />);
    expect(screen.queryAllByTestId('model-chip')).toHaveLength(0);
  });
});
