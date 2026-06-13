import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DeliveryPlaceholder from './DeliveryPlaceholder';

describe('DeliveryPlaceholder', () => {
  it('skips with null delivery', () => {
    const onSkip = vi.fn();
    const { getByText } = render(<DeliveryPlaceholder onSkip={onSkip} onBack={() => {}} />);
    fireEvent.click(getByText(/Skip for now/i));
    expect(onSkip).toHaveBeenCalled();
  });
});
