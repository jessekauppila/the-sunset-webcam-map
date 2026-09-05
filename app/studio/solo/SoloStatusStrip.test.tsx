import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoloStatusStrip } from './SoloStatusStrip';
import type { StateView } from '@/app/api/kiosk/solo/view';

it('counts down to the next pull, reports the last pull per feed, the glass revision, and the zone', () => {
  const lastPull = { admitted: { sunset: 3, nonSunset: 4 } };
  const v = (feed: 'sunrise' | 'sunset') => ({ feed, lastPull } as unknown as StateView);
  render(<SoloStatusStrip nowMs={60_000} sunrise={v('sunrise')} sunset={v('sunset')} liveRevision={41} diffCount={3} zone={{ minDeg: -24, maxDeg: 14 }} />);
  expect(screen.getByText('9:00')).toBeInTheDocument();
  expect(screen.getByText(/↑ 3 \+ 4 · ↓ 3 \+ 4/)).toBeInTheDocument();
  expect(screen.getByText(/rev 41/)).toBeInTheDocument();
  expect(screen.getByText(/3 differ/)).toBeInTheDocument();
  expect(screen.getByText(/−24° … \+14°/)).toBeInTheDocument();
});
