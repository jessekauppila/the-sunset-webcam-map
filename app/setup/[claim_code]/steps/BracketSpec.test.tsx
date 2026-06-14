import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import BracketSpec from './BracketSpec';

describe('BracketSpec', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });

  it('shows the snapped wedge angle and recommended lens', () => {
    const { getByText, container } = render(
      <BracketSpec facing="west" solution={solution} onNext={() => {}} onBack={() => {}} />
    );
    expect(getByText(/Your bracket/)).toBeTruthy();
    expect(container.textContent).toContain(`${solution.angle}°`);
    expect(container.textContent?.toLowerCase()).toContain('wide');
  });
});
