import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SweepOverlayControl } from './SweepOverlayControl';
import { DEFAULT_TOGGLES, useSweepOverlayStore } from '@/app/store/useSweepOverlayStore';
import { TERMINATOR_SUN_ALTITUDE_DEG } from '@/app/lib/masterConfig';

beforeEach(() => {
  window.localStorage.clear();
  useSweepOverlayStore.setState({ ...DEFAULT_TOGGLES, hydrated: false });
});

describe('SweepOverlayControl', () => {
  it('names each ring by its solar altitude and starts every switch off', () => {
    render(<SweepOverlayControl />);
    const base = screen.getByRole('switch', { name: `base ring ${TERMINATOR_SUN_ALTITUDE_DEG}°` });
    expect(base).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /day ring \+/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /night ring -/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Windy boxes' })).not.toBeChecked();
  });

  it('flips the store when a switch is toggled', () => {
    render(<SweepOverlayControl />);
    fireEvent.click(screen.getByRole('switch', { name: /day ring/ }));
    expect(useSweepOverlayStore.getState().showDay).toBe(true);
  });

  it('shows what was remembered from a previous visit', () => {
    window.localStorage.setItem('sweep-overlay-toggles', JSON.stringify({ showBoxes: true }));
    render(<SweepOverlayControl />);
    expect(screen.getByRole('switch', { name: 'Windy boxes' })).toBeChecked();
  });
});
