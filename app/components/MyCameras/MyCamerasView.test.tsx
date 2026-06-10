import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

// Stub the actual map — we only test the surrounding chrome here.
vi.mock('@/app/components/Map/SimpleMap', () => ({
  __esModule: true,
  default: () => <div data-testid="simple-map" />,
}));

// Loader is a no-op in the test; data is injected via the store.
vi.mock('@/app/store/useLoadMyCameras', () => ({
  useLoadMyCameras: () => {},
}));

import { useMyCamerasStore } from '@/app/store/useMyCamerasStore';
import { MyCamerasView } from './MyCamerasView';

let nextId = 1;
const mk = (
  title: string,
  health: MyCameraMarker['health'],
  isInWindowNow = false
): MyCameraMarker => {
  const id = nextId++;
  return {
    markerId: id, cameraId: id, webcamId: id, title, lat: 0, lng: 0,
    health, isInWindowNow, lastHeartbeatAt: null, lastSnapshotAt: null,
    latestSnapshotUrl: null, phase: 'both',
  };
};

beforeEach(() => {
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
});
