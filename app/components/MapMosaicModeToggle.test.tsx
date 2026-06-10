// app/components/MapMosaicModeToggle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapMosaicModeToggle } from './MapMosaicModeToggle';

describe('MapMosaicModeToggle', () => {
  it('hides the My Cameras button by default (logged out)', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /my cameras/i })).toBeNull();
  });

  it('shows the My Cameras button when showMyCameras is true', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} showMyCameras />);
    expect(screen.getByRole('button', { name: /my cameras/i })).toBeInTheDocument();
  });
});
