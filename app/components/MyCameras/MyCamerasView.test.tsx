import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

// Stub the actual map — we only test the surrounding chrome here.
vi.mock('@/app/components/Map/SimpleMap', () => ({
  __esModule: true,
  default: () => <div data-testid="simple-map" />,
}));

// Loader is a spy so we can assert the includeEnded arg it receives.
const mockUseLoadMyCameras = vi.fn();
vi.mock('@/app/store/useLoadMyCameras', () => ({
  useLoadMyCameras: (opts?: { includeEnded?: boolean }) => mockUseLoadMyCameras(opts),
}));

import { useMyCamerasStore } from '@/app/store/useMyCamerasStore';
import { MyCamerasView } from './MyCamerasView';

let nextId = 1;
const mk = (
  title: string,
  health: MyCameraMarker['health'],
  isInWindowNow = false,
  overrides: Partial<MyCameraMarker> = {}
): MyCameraMarker => {
  const id = nextId++;
  return {
    markerId: id, cameraId: id, webcamId: id, title, lat: 0, lng: 0,
    health, isInWindowNow, lastHeartbeatAt: null, lastSnapshotAt: null,
    latestSnapshotUrl: null, phase: 'both',
    state: null, ended_at: null,
    ...overrides,
  };
};

beforeEach(() => {
  nextId = 1;
  mockUseLoadMyCameras.mockClear();
  useMyCamerasStore.setState({
    cameras: [
      mk('alpha', 'live', true),
      mk('bravo', 'offline', false),
      mk('charlie', 'stale', true),
    ],
    loading: false,
    error: undefined,
  });
});

describe('MyCamerasView', () => {
  it('renders the map and a summary of health counts', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    expect(screen.getByTestId('simple-map')).toBeInTheDocument();
    expect(screen.getByTestId('summary-live')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-stale')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-offline')).toHaveTextContent('1');
  });

  it('lists cameras worst-health first', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    const rows = screen.getAllByTestId('camera-row');
    expect(rows.map((r) => r.getAttribute('data-title'))).toEqual([
      'bravo', // offline
      'charlie', // stale
      'alpha', // live
    ]);
  });

  it('filters to in-window cameras when In-range is selected', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /in-range filter/i }));
    const rows = screen.getAllByTestId('camera-row');
    expect(rows.map((r) => r.getAttribute('data-title'))).toEqual(['charlie', 'alpha']);
    expect(screen.queryByText('bravo')).not.toBeInTheDocument();
  });

  it('collapses the camera list', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    expect(screen.getAllByTestId('camera-row').length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: /collapse list/i }));
    expect(screen.queryAllByTestId('camera-row').length).toBe(0);
  });

  describe('show-decommissioned toggle', () => {
    it('toggle is OFF by default and loader is called without includeEnded', () => {
      render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
      // The toggle button should be present and not pressed
      const toggle = screen.getByRole('button', { name: /show decommissioned/i });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      // Loader must have been called with includeEnded falsy/absent
      expect(mockUseLoadMyCameras).toHaveBeenCalledWith(
        expect.objectContaining({ includeEnded: false })
      );
    });

    it('toggle ON calls loader with includeEnded: true', () => {
      render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
      fireEvent.click(screen.getByRole('button', { name: /show decommissioned/i }));
      // After toggle, loader should be called with includeEnded: true
      const calls = mockUseLoadMyCameras.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toEqual(expect.objectContaining({ includeEnded: true }));
    });

    it('ended markers are visually distinct with decommissioned label', () => {
      // Inject an ended deployment marker alongside an active one
      useMyCamerasStore.setState({
        cameras: [
          mk('active-cam', 'live', false),
          mk('old-site', 'offline', false, {
            state: 'ended',
            ended_at: '2025-01-01T00:00:00Z',
          }),
        ],
        loading: false,
        error: undefined,
      });

      render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
      // Turn on the toggle
      fireEvent.click(screen.getByRole('button', { name: /show decommissioned/i }));

      // The ended marker should appear in the list
      expect(screen.getByText('old-site')).toBeInTheDocument();
      // It should have a decommissioned indicator
      expect(screen.getByTestId('decommissioned-badge')).toBeInTheDocument();
    });
  });
});
