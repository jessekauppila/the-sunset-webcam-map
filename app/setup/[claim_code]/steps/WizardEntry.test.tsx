import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WizardEntry from './WizardEntry';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl) as unknown as typeof fetch);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WizardEntry', () => {
  it('fresh camera (no active placement) → routes into the commission flow', async () => {
    mockFetch(async () => jsonResponse({ status: 'awaiting_wifi' }));
    const onCommission = vi.fn();
    const onReaim = vi.fn();

    render(
      <WizardEntry claimCode="SUNSET-AAAA-BBBB" onCommission={onCommission} onReaim={onReaim} />
    );

    await waitFor(() => expect(onCommission).toHaveBeenCalledTimes(1));
    expect(onReaim).not.toHaveBeenCalled();
  });

  it('already-placed camera → offers Re-aim (primary) above Turn off (secondary)', async () => {
    mockFetch(async () => jsonResponse({ status: 'ready' }));
    const onCommission = vi.fn();
    const onReaim = vi.fn();

    render(
      <WizardEntry claimCode="SUNSET-AAAA-BBBB" onCommission={onCommission} onReaim={onReaim} />
    );

    const reaim = await screen.findByRole('button', { name: /re-?aim|move/i });
    const turnOff = screen.getByRole('button', { name: /turn off|decommission/i });

    // Ordering: Re-aim must appear before Turn off in the DOM.
    expect(reaim.compareDocumentPosition(turnOff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A placed camera must NOT auto-route into commission.
    expect(onCommission).not.toHaveBeenCalled();
  });

  it('Re-aim lands in the bracket flow (calls onReaim, not a decommission gate)', async () => {
    mockFetch(async () => jsonResponse({ status: 'ready' }));
    const onReaim = vi.fn();

    render(
      <WizardEntry claimCode="SUNSET-AAAA-BBBB" onCommission={vi.fn()} onReaim={onReaim} />
    );

    const reaim = await screen.findByRole('button', { name: /re-?aim|move/i });
    fireEvent.click(reaim);
    expect(onReaim).toHaveBeenCalledTimes(1);
  });

  it('Turn off posts to the decommission endpoint (claim-code scoped)', async () => {
    const calls: string[] = [];
    mockFetch(async (url) => {
      calls.push(url);
      if (url.includes('/decommission')) return jsonResponse({ status: 'decommissioned' });
      return jsonResponse({ status: 'ready' });
    });

    render(
      <WizardEntry claimCode="SUNSET-AAAA-BBBB" onCommission={vi.fn()} onReaim={vi.fn()} />
    );

    const turnOff = await screen.findByRole('button', { name: /turn off|decommission/i });
    fireEvent.click(turnOff);

    await waitFor(() =>
      expect(calls.some((u) => u.includes('/decommission'))).toBe(true)
    );
    expect(calls.some((u) => u.includes('SUNSET-AAAA-BBBB'))).toBe(true);
  });
});
