import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CameraBestStrip } from './CameraBestStrip';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function entry(id: number, q: number) {
  return {
    id,
    firebaseUrl: `https://x/${id}.jpg`,
    capturedAt: '2026-06-10T04:00:00.000Z',
    llmQuality: q,
    webcamId: 42,
  };
}

describe('CameraBestStrip', () => {
  it('fetches the webcam-scoped leaderboard and renders ranked frames with a quality badge', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ entries: [entry(1, 0.92), entry(2, 0.8)] }),
    });
    render(<CameraBestStrip webcamId={42} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/leaderboards?webcam_id=42')
    );
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('shows an empty state when the camera has no ranked frames', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ entries: [] }) });
    render(<CameraBestStrip webcamId={42} />);
    await waitFor(() =>
      expect(screen.getByText(/no ranked frames yet/i)).toBeInTheDocument()
    );
  });
});
