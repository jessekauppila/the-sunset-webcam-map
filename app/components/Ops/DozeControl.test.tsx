import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DozeControl } from './DozeControl';

describe('DozeControl', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows awake state and dozes on click', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ doze: false }) }) // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ doze: true }) }); // POST
    render(<DozeControl />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /doze kiosks/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /doze kiosks/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /wake kiosks/i })).toBeInTheDocument(),
    );
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(String(postCall![0])).toContain('/api/kiosk/doze');
    expect(JSON.parse(postCall![1].body as string)).toEqual({ doze: true });
  });
});
