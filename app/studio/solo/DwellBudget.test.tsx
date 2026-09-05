import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DwellBudget } from './DwellBudget';

it('prints the split and turns red when the dwell cannot fit the dials', () => {
  render(<DwellBudget dials={{ dwellS: 20, prelude: true, preludeFrames: 3, preludeStepS: 1.5, leadS: 4 }} />);
  expect(screen.getByText('prelude 4.5 s + lead 4 s + hold 11.5 s')).toHaveStyle({ color: '#8b95a7' });
  render(<DwellBudget dials={{ dwellS: 8, prelude: true, preludeFrames: 3, preludeStepS: 1.5, leadS: 4 }} />);
  expect(screen.getByText(/clamped/)).toHaveStyle({ color: '#f47174' });
});
