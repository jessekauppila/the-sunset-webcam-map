import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../lib/useGeolocation', () => ({
  useGeolocation: () => ({ result: { lat: 48.75, lng: -122.48, elevationM: 30 }, error: null, pending: false }),
}));
const trueHeading = { orientation: { azimuthDeg: 262, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), declinationDeg: 15, trueHeading: 277, error: null };
vi.mock('../lib/useTrueHeading', () => ({ useTrueHeading: () => trueHeading }));

import MeasureWindow from './MeasureWindow';

beforeEach(() => vi.clearAllMocks());

describe('MeasureWindow', () => {
  it('captures the magnetic azimuth, declination, geo, and timezone', () => {
    const onCapture = vi.fn();
    const { getByText } = render(<MeasureWindow facing="west" onCapture={onCapture} onBack={() => {}} />);
    fireEvent.click(getByText(/Capture/));
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMagAz: 262,
        declinationDeg: 15,
        geo: { lat: 48.75, lng: -122.48, elevationM: 30 },
      })
    );
    expect(onCapture.mock.calls[0][0].timezone).toBeTruthy();
  });
});
