import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import MountConfirm from './MountConfirm';

describe('MountConfirm', () => {
  const solution = solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 });
  it('confirms the view and advances', () => {
    const onConfirm = vi.fn();
    const { getByText } = render(
      <MountConfirm facing="west" solution={solution} onConfirm={onConfirm} onBack={() => {}} />
    );
    fireEvent.click(getByText(/Looks right/i));
    expect(onConfirm).toHaveBeenCalled();
  });
});
