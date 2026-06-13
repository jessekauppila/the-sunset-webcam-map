import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the polling so ConfirmCamera doesn't hit the network on mount.
vi.mock('./lib/usePolling', () => ({
  usePolling: () => ({ latest: null, error: null, stopped: false }),
}));

import WizardClient from './WizardClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WizardClient', () => {
  it('a fresh camera routes through the entry into the connect step', async () => {
    // Entry reads setup-status; a non-ready camera is "fresh" → commission flow.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ status: 'awaiting_wifi' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      ) as unknown as typeof fetch
    );

    render(<WizardClient claimCode="SUNSET-7K3M-9XQ2" />);

    expect(await screen.findByText(/Connect your camera/i)).toBeTruthy();
    expect(screen.getByText(/Step 1 of 9/)).toBeTruthy();
  });
});
