import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import SunriseKioskPage from './page';

// GeoMosaic uses HTMLCanvasElement which jsdom doesn't support — mock it
vi.mock('@/app/components/mosaic/v1', () => ({
  MosaicV1: (props: Record<string, unknown>) => (
    <div
      data-testid="geo-mosaic"
      data-props={JSON.stringify(props)}
      data-count={(props.webcams as unknown[]).length}
    />
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

const useKioskRuntimeMock = vi.fn(() => ({ dozing: false }));
vi.mock('../useKioskRuntime', () => ({
  useKioskRuntime: () => useKioskRuntimeMock(),
}));

const useSearchParamsMock = vi.fn(() => new URLSearchParams());
vi.mock('next/navigation', () => ({
  useSearchParams: () => useSearchParamsMock(),
}));

function getMosaicProps() {
  const el = screen.getByTestId('geo-mosaic');
  return JSON.parse(el.getAttribute('data-props') as string);
}

describe('SunriseKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKioskRuntimeMock.mockReturnValue({ dozing: false });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it('renders GeoMosaic', () => {
    render(<SunriseKioskPage />);
    expect(screen.getByTestId('geo-mosaic')).toBeDefined();
  });

  it('passes feed="sunrise" to GeoMosaic', () => {
    render(<SunriseKioskPage />);
    expect(getMosaicProps().feed).toBe('sunrise');
  });

  it('passes sunrise webcams to GeoMosaic', () => {
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunrise: unknown[] }) => unknown) =>
        selector({ sunrise: [{ webcamId: 1 }, { webcamId: 2 }] })
    );

    render(<SunriseKioskPage />);
    const canvas = screen.getByTestId('geo-mosaic');
    expect(canvas.getAttribute('data-count')).toBe('2');
  });

  it('hands the sunset pool over as the peer, so both screens share one scale', () => {
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunrise: unknown[]; sunset: unknown[] }) => unknown) =>
        selector({ sunrise: [{ webcamId: 1 }], sunset: [{ webcamId: 7 }, { webcamId: 8 }] })
    );

    render(<SunriseKioskPage />);
    expect(getMosaicProps().peerWebcams).toHaveLength(2);
  });

  it('does not set setupMode without ?setup=1', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    render(<SunriseKioskPage />);
    expect(getMosaicProps().setupMode).toBeFalsy();
  });

  it('sets setupMode true when ?setup=1', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('setup=1'));
    render(<SunriseKioskPage />);
    expect(getMosaicProps().setupMode).toBe(true);
  });

  it('pauses the terminator-webcams poll when the kiosk is dozing', () => {
    useKioskRuntimeMock.mockReturnValue({ dozing: true });
    render(<SunriseKioskPage />);
    expect(useLoadTerminatorWebcams).toHaveBeenCalledWith({ paused: true });
  });
});
