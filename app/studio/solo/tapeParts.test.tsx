import { it, expect } from 'vitest';
import { seamBetween } from './tapeParts';

// Until now the tape drew "crossfade N s: both pictures on glass" on every
// cut from `fadeS` alone. At the live `dip` that was a 6 s overlap on every
// seam where the real overlap was none — the operator's own instrument
// reporting a thing the glass does not do.
const dip = { dwellS: 20, fadeS: 6, transition: 'dip' as const, sameCameraFadeS: 2, veil: '#000000' };

it('seamBetween is pure and says the same thing', () => {
  expect(seamBetween({ webcamId: 1 }, { webcamId: 2 }, dip)).toEqual({ kind: 'dip', seconds: 6, veil: '#000000' });
  expect(seamBetween({ webcamId: 1 }, { webcamId: 1 }, dip)).toEqual({ kind: 'dissolve', seconds: 2, veil: null });
  expect(seamBetween({ webcamId: 1 }, { webcamId: 1 }, { ...dip, sameCameraFadeS: 0 })).toEqual({ kind: 'cut', seconds: 0, veil: null });
  expect(seamBetween(null, { webcamId: 2 }, { dwellS: 20, fadeS: 2 })).toEqual({ kind: 'crossfade', seconds: 2, veil: null });
});
