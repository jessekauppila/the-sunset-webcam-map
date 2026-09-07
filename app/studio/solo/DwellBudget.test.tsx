import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DwellBudget } from './DwellBudget';

const D = { dwellS: 20, leadS: 4, minStepS: 4 };

it('prints how the dwell splits between the frames of the camera on glass', () => {
  const { rerender } = render(<DwellBudget dials={D} frames={4} />);
  expect(screen.getByText(/4 frames × 5 s · lead 4 s/)).toBeInTheDocument();
  rerender(<DwellBudget dials={{ ...D, leadS: 0 }} />);
  expect(screen.getByText(/1 frame · 20 s/)).toBeInTheDocument();
});

it('names the threshold, which is the number that tells an operator what a cap costs', () => {
  render(<DwellBudget dials={D} frames={4} />);
  // 20 s over a 4 s floor: up to five frames divide the dwell for free.
  expect(screen.getByText('divides the dwell up to 5 frames')).toBeInTheDocument();
});

it('says so when the run stretches the dwell rather than dividing it', () => {
  render(<DwellBudget dials={D} frames={8} />);
  expect(screen.getByText(/8 frames × 4 s/)).toBeInTheDocument();
  expect(screen.getByText(/· dwell 32 s/)).toBeInTheDocument();
  expect(screen.getByText('stretched: past 5 frames each one adds 4 s')).toBeInTheDocument();
});

it('the threshold moves with the floor, not just the dwell', () => {
  const { rerender } = render(<DwellBudget dials={{ ...D, minStepS: 6 }} frames={2} />);
  expect(screen.getByText('divides the dwell up to 3 frames')).toBeInTheDocument();
  rerender(<DwellBudget dials={{ ...D, dwellS: 60 }} frames={2} />);
  expect(screen.getByText('divides the dwell up to 15 frames')).toBeInTheDocument();
});
