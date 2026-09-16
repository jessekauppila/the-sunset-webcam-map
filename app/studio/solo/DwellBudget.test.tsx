import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DwellBudget } from './DwellBudget';

const D = { beatS: 4, dwellBeats: 3, changeBeats: 1, leadS: 0, transition: 'dip' as const };

it('prints the run in beats: frames, the change, and the rest on the last frame', () => {
  const { rerender } = render(<DwellBudget dials={D} frames={8} />);
  expect(screen.getByText('8 frames × 4 s · 1 beat change')).toBeInTheDocument();
  expect(screen.getByText('36 s at the still dial · ends on a tick')).toBeInTheDocument();
  rerender(<DwellBudget dials={D} frames={1} />);
  expect(screen.getByText('1 frame × 4 s · 1 beat change · rests 2 beats')).toBeInTheDocument();
  expect(screen.getByText('16 s at the still dial · ends on a tick')).toBeInTheDocument();
});

it('a cut has no change beat and the lead is named', () => {
  render(<DwellBudget dials={{ ...D, transition: 'cut', leadS: 4 }} frames={3} />);
  expect(screen.getByText('3 frames × 4 s · lead 4 s')).toBeInTheDocument();
  expect(screen.getByText('12 s at the still dial · ends on a tick')).toBeInTheDocument();
});

const PEAK_MS = Date.parse('2026-09-16T12:41:08Z');
const peakTime = () =>
  new Date(PEAK_MS).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

it('a fitted rendezvous names the other screen it lands with', () => {
  render(<DwellBudget dials={D} frames={8} landings={{
    sunrise: { atMs: PEAK_MS, rendezvous: true },
    sunset: null,
  }} />);
  expect(screen.getByText(`sunrise lands ${peakTime()} with the sunset screen`)).toBeInTheDocument();
});

it('a pinned dwell just names its own time, and a null landing prints nothing', () => {
  render(<DwellBudget dials={D} frames={8} landings={{
    sunrise: null,
    sunset: { atMs: PEAK_MS, rendezvous: false },
  }} />);
  expect(screen.getByText(`sunset pins ${peakTime()}`)).toBeInTheDocument();
  expect(screen.queryByText(/^sunrise (lands|pins)/)).not.toBeInTheDocument();
});
