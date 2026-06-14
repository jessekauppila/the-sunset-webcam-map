import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import Assemble from './Assemble';

describe('Assemble', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });
  it('advances on the mount-it button', () => {
    const onNext = vi.fn();
    const { getByText } = render(<Assemble solution={solution} onNext={onNext} onBack={() => {}} />);
    fireEvent.click(getByText(/power it on|mounted/i));
    expect(onNext).toHaveBeenCalled();
  });
});
