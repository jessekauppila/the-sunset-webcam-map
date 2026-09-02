// app/components/MapMosaicModeToggle.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { MapMosaicModeToggle } from './MapMosaicModeToggle';

describe('MapMosaicModeToggle', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('offers Studio and My Cameras to everyone, since each gates itself', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /studio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my cameras/i })).toBeInTheDocument();
  });

  it('no longer offers the single-feed mosaic views', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /mosaics/i })).toBeNull();
  });

  it('navigates to /studio rather than switching the view mode', async () => {
    const onModeChange = vi.fn();
    render(<MapMosaicModeToggle mode="globe" onModeChange={onModeChange} />);

    await userEvent.click(screen.getByRole('button', { name: /studio/i }));

    expect(push).toHaveBeenCalledWith('/studio');
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('still switches the view mode for real modes', async () => {
    const onModeChange = vi.fn();
    render(<MapMosaicModeToggle mode="globe" onModeChange={onModeChange} />);

    await userEvent.click(screen.getByRole('button', { name: /my cameras/i }));

    expect(onModeChange).toHaveBeenCalledWith('my-cameras');
    expect(push).not.toHaveBeenCalled();
  });
});
