import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SunsetKioskPage from './page';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';

vi.mock('@/app/components/mosaic/v1', () => ({
  MosaicV1: (props: Record<string, unknown>) => (
    <div
      data-testid="geo-mosaic"
      data-props={JSON.stringify(props)}
      data-count={(props.webcams as unknown[]).length}
    />
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

describe('SunsetKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKioskRuntimeMock.mockReturnValue({ dozing: false });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[] }) => unknown) =>
        selector({ sunset: [] })
    );
  });

  it('renders GeoMosaic', () => {
    render(<SunsetKioskPage />);
    expect(screen.getByTestId('geo-mosaic')).toBeDefined();
  });

  it('passes feed="sunset" to GeoMosaic', () => {
    render(<SunsetKioskPage />);
    expect(getMosaicProps().feed).toBe('sunset');
  });

  it('passes sunset webcams to GeoMosaic', () => {
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[] }) => unknown) =>
        selector({ sunset: [{ webcamId: 3 }, { webcamId: 4 }, { webcamId: 5 }] })
    );

    render(<SunsetKioskPage />);
    const canvas = screen.getByTestId('geo-mosaic');
    expect(canvas.getAttribute('data-count')).toBe('3');
  });

  it('does not set setupMode without ?setup=1', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    render(<SunsetKioskPage />);
    expect(getMosaicProps().setupMode).toBeFalsy();
  });

  it('sets setupMode true when ?setup=1', () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('setup=1'));
    render(<SunsetKioskPage />);
    expect(getMosaicProps().setupMode).toBe(true);
  });

  it('pauses the terminator-webcams poll when the kiosk is dozing', () => {
    useKioskRuntimeMock.mockReturnValue({ dozing: true });
    render(<SunsetKioskPage />);
    expect(useLoadTerminatorWebcams).toHaveBeenCalledWith({ paused: true });
  });
});
