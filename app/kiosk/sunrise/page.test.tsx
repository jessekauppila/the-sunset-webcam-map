import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import SunriseKioskPage from './page';

// MosaicCanvas uses HTMLCanvasElement which jsdom doesn't support — mock it
vi.mock('@/app/components/MosaicCanvas', () => ({
  MosaicCanvas: ({ webcams }: { webcams: unknown[] }) => (
    <div data-testid="mosaic-canvas" data-count={webcams.length} />
  ),
}));

// SWR data fetching — prevent real network calls in tests
vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({
  useLoadTerminatorWebcams: vi.fn(),
}));

// Zustand store — return empty webcams by default
vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: vi.fn((selector: (state: { sunrise: unknown[] }) => unknown) =>
    selector({ sunrise: [] })
  ),
}));

describe('SunriseKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MosaicCanvas', () => {
    render(<SunriseKioskPage />);
    expect(screen.getByTestId('mosaic-canvas')).toBeDefined();
  });

  it('passes sunrise webcams to MosaicCanvas', () => {
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunrise: unknown[] }) => unknown) =>
        selector({ sunrise: [{ webcamId: 1 }, { webcamId: 2 }] })
    );

    render(<SunriseKioskPage />);
    const canvas = screen.getByTestId('mosaic-canvas');
    expect(canvas.getAttribute('data-count')).toBe('2');
  });
});
