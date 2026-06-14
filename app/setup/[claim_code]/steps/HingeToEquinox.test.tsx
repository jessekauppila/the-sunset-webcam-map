import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';

const trueHeading = { orientation: { azimuthDeg: 255, tiltDeg: -90 }, permissionState: 'granted', requestPermission: vi.fn(), declinationDeg: 15, trueHeading: 270, error: null };
vi.mock('../lib/useTrueHeading', () => ({ useTrueHeading: () => trueHeading }));

import HingeToEquinox from './HingeToEquinox';

beforeEach(() => vi.clearAllMocks());

describe('HingeToEquinox', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  it('renders the hinge instruction and a lock affordance', () => {
    const { getByText } = render(
      <HingeToEquinox facing="west" lat={48.75} lng={-122.48} solution={solution} onLock={() => {}} onBack={() => {}} />
    );
    expect(getByText(/Hinge to the equinox/)).toBeTruthy();
  });
});
