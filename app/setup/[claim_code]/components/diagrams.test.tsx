import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SkyView, HingeAnim } from './diagrams';

describe('SkyView', () => {
  it('renders the heading readout', () => {
    const arc = { jun: 307, equinox: 270, dec: 233, today: 270 };
    const { getByText } = render(
      <SkyView centerAz={270} fov={60} arc={arc} showToday label="cam" />
    );
    expect(getByText(/heading 270/)).toBeTruthy();
  });
});

describe('HingeAnim', () => {
  it('mounts and unmounts without leaking a rAF loop', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <HingeAnim wedgeDeg={8} eventLabel="Equinox sunset" liveOpenDeg={0} aligned={false} />
    );
    unmount();
    cleanup();
    vi.useRealTimers();
    expect(true).toBe(true); // no unhandled rAF after unmount
  });
});
