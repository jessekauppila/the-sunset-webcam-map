// app/components/MyCameras/CameraHealthHeader.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraHealthHeader, relativeTime } from './CameraHealthHeader';
import type { WindyWebcam } from '@/app/lib/types';

const base: WindyWebcam = {
  webcamId: 1,
  title: 'deck-west',
  viewCount: 0,
  status: 'stale',
  location: { latitude: 0, longitude: 0 },
  categories: [],
};

describe('relativeTime', () => {
  const now = new Date('2026-06-09T10:00:00Z');
  it('formats nulls, minutes, hours, and days', () => {
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('2026-06-09T09:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-06-09T06:00:00Z', now)).toBe('4h ago');
    expect(relativeTime('2026-06-07T10:00:00Z', now)).toBe('2d ago');
  });
});

describe('CameraHealthHeader', () => {
  it('renders nothing for a webcam without cameraHealth', () => {
    const { container } = render(<CameraHealthHeader webcam={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the health label for a custom camera', () => {
    render(<CameraHealthHeader webcam={{ ...base, cameraHealth: 'offline' }} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
