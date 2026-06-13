import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Stub the polling so ConfirmCamera doesn't hit the network on mount.
vi.mock('./lib/usePolling', () => ({
  usePolling: () => ({ latest: null, error: null, stopped: false }),
}));

import WizardClient from './WizardClient';

describe('WizardClient', () => {
  it('renders the connect step first', () => {
    const { getByText } = render(<WizardClient claimCode="SUNSET-7K3M-9XQ2" />);
    expect(getByText(/Connect your camera/i)).toBeTruthy();
    expect(getByText(/Step 1 of 9/)).toBeTruthy();
  });
});
