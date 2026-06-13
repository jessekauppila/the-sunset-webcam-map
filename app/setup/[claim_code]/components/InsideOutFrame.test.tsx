import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InsideOutFrame, Chip, Why } from './InsideOutFrame';

describe('InsideOutFrame', () => {
  it('renders the OUTSIDE / INSIDE frame labels', () => {
    const { getByText } = render(
      <InsideOutFrame H={150} glassY={52}><rect /></InsideOutFrame>
    );
    expect(getByText('OUTSIDE')).toBeTruthy();
    expect(getByText(/INSIDE/)).toBeTruthy();
  });

  it('Chip and Why render their children', () => {
    const { getByText } = render(<><Chip>hello</Chip><Why>why text</Why></>);
    expect(getByText('hello')).toBeTruthy();
    expect(getByText('why text')).toBeTruthy();
  });
});
