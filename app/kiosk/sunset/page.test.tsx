import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SunsetKioskPage from './page';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';

vi.mock('@/app/components/MosaicCanvas', () => ({
  MosaicCanvas: ({ webcams }: { webcams: unknown[] }) => (
    <div data-testid="mosaic-canvas" data-count={webcams.length} />
  ),
}));

vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({
  useLoadTerminatorWebcams: vi.fn(),
}));

vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: vi.fn((selector: (state: { sunset: unknown[] }) => unknown) =>
    selector({ sunset: [] })
  ),
}));

describe('SunsetKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[] }) => unknown) =>
        selector({ sunset: [] })
    );
  });

  it('renders MosaicCanvas', () => {
    render(<SunsetKioskPage />);
    expect(screen.getByTestId('mosaic-canvas')).toBeDefined();
  });

  it('passes sunset webcams to MosaicCanvas', () => {
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[] }) => unknown) =>
        selector({ sunset: [{ webcamId: 3 }, { webcamId: 4 }, { webcamId: 5 }] })
    );

    render(<SunsetKioskPage />);
    const canvas = screen.getByTestId('mosaic-canvas');
    expect(canvas.getAttribute('data-count')).toBe('3');
  });
});
