import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FacingPhase from './FacingPhase';

describe('FacingPhase', () => {
  it('emits "east" when Sunrise is chosen', () => {
    const onChoose = vi.fn();
    const { getByText } = render(<FacingPhase onChoose={onChoose} />);
    fireEvent.click(getByText('Sunrise'));
    expect(onChoose).toHaveBeenCalledWith('east');
  });

  it('emits "west" when Sunset is chosen', () => {
    const onChoose = vi.fn();
    const { getByText } = render(<FacingPhase onChoose={onChoose} />);
    fireEvent.click(getByText('Sunset'));
    expect(onChoose).toHaveBeenCalledWith('west');
  });
});
