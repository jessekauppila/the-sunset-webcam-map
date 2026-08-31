import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MainViewContainer from './MainViewContainer';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';

vi.mock('@/app/components/mosaic/v1', () => ({
  MosaicV1: (props: Record<string, unknown>) => (
    <div
      data-testid="geo-mosaic"
      data-props={JSON.stringify(props)}
      data-count={(props.webcams as unknown[]).length}
    />
  ),
}));

vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: vi.fn(
    (selector: (state: { sunset: unknown[]; sunrise: unknown[] }) => unknown) =>
      selector({ sunset: [{ webcamId: 1 }], sunrise: [{ webcamId: 2 }] })
  ),
}));

// MainViewContainer also imports these for other view modes (map/rating/
// swipe/my-cameras). They pull in heavy deps (mapbox-gl CSS, etc.) that
// aren't relevant to the mosaic-mode tests here, so stub them out.
vi.mock('./Map/SimpleMap', () => ({
  default: () => <div data-testid="simple-map" />,
}));
vi.mock('./Rating/RatingPanel', () => ({
  RatingPanel: () => <div data-testid="rating-panel" />,
}));
vi.mock('./SwipeSnapshotGallery', () => ({
  SwipeSnapshotGallery: () => <div data-testid="swipe-gallery" />,
}));
vi.mock('./MyCameras/MyCamerasView', () => ({
  MyCamerasView: () => <div data-testid="my-cameras-view" />,
}));

function getMosaicProps() {
  const el = screen.getByTestId('geo-mosaic');
  return JSON.parse(el.getAttribute('data-props') as string);
}

const userLocation = { lat: 48.7519, lng: -122.4787 };

describe('MainViewContainer mosaic modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[]; sunrise: unknown[] }) => unknown) =>
        selector({ sunset: [{ webcamId: 1 }], sunrise: [{ webcamId: 2 }] })
    );
    // jsdom returns all-zero rects by default; give the mosaic container a
    // real size so MainViewContainer's height-gated render actually mounts
    // GeoMosaic (mirrors the existing MosaicCanvas gating behavior).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 900,
      height: 800,
      top: 0,
      left: 0,
      right: 900,
      bottom: 800,
      toJSON: () => {},
    });
  });

  it('renders GeoMosaic with feed="sunset" in sunset-mosaic mode', () => {
    render(<MainViewContainer userLocation={userLocation} mode="sunset-mosaic" />);
    expect(getMosaicProps().feed).toBe('sunset');
  });

  it('renders GeoMosaic with feed="sunrise" in sunrise-mosaic mode', () => {
    render(<MainViewContainer userLocation={userLocation} mode="sunrise-mosaic" />);
    expect(getMosaicProps().feed).toBe('sunrise');
  });
});
