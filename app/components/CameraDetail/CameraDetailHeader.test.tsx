import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraDetailHeader } from './CameraDetailHeader';
import type { CameraDetail } from '@/app/lib/cameraDetail';

const base: CameraDetail = {
  cameraId: 7, webcamId: 42, title: 'sunset-cam-1', hardwareId: 'sunset-cam-1',
  deviceClass: 'rpi-zero-2w', firmwareVersion: '0.4.2', lat: 48.75, lng: -122.48,
  phase: 'sunset', status: 'active', registeredAt: '2026-05-01T00:00:00.000Z',
  lastHeartbeatAt: '2026-06-10T04:00:00.000Z', lastSnapshotAt: '2026-06-10T04:01:00.000Z',
  latestSnapshotUrl: 'https://x/y.jpg', health: 'live', isInWindowNow: true,
};

describe('CameraDetailHeader', () => {
  it('shows the title and health label', () => {
    render(<CameraDetailHeader detail={base} />);
    expect(screen.getByText('sunset-cam-1')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders firmware when present and omits it when null', () => {
    const { rerender } = render(<CameraDetailHeader detail={base} />);
    expect(screen.getByText(/0\.4\.2/)).toBeInTheDocument();
    rerender(<CameraDetailHeader detail={{ ...base, firmwareVersion: null }} />);
    expect(screen.queryByText(/fw/i)).toBeNull();
  });

  it('renders a placeholder instead of an image for a never-reported camera', () => {
    render(
      <CameraDetailHeader
        detail={{ ...base, health: 'never', latestSnapshotUrl: null }}
      />
    );
    expect(screen.getByText('Never reported')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
