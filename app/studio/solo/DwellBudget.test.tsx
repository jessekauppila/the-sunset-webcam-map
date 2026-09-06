import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DwellBudget } from './DwellBudget';

it('prints how the dwell splits between the frames of the camera on glass', () => {
  const { rerender } = render(<DwellBudget dials={{ dwellS: 20, leadS: 4 }} frames={4} />);
  expect(screen.getByText('4 frames × 5 s · lead 4 s')).toHaveStyle({ color: '#8b95a7' });
  rerender(<DwellBudget dials={{ dwellS: 20, leadS: 0 }} />);
  expect(screen.getByText('1 frame · 20 s')).toBeInTheDocument();
});
