import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CameraImageHistory } from './CameraImageHistory';

function snap(id: number) {
  return {
    webcamId: 42,
    title: 'sunset-cam-1',
    snapshot: {
      id,
      firebaseUrl: `https://x/${id}.jpg`,
      capturedAt: '2026-06-10T04:00:00.000Z',
      phase: 'sunset',
    },
    llmQuality: 0.8,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('CameraImageHistory', () => {
  it('renders fetched snapshots as image tiles', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snapshots: [snap(1), snap(2)], total: 2, limit: 24, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/snapshots?webcam_id=42&mode=archive')
    );
  });

  it('loads more, advancing the offset, and hides the button at the end', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snapshots: [snap(1)], total: 2, limit: 1, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} pageSize={1} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snapshots: [snap(2)], total: 2, limit: 1, offset: 1 }),
    });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toContain('offset=1');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('shows an empty state when there are no captures', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snapshots: [], total: 0, limit: 24, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} />);
    await waitFor(() =>
      expect(screen.getByText(/no captures yet/i)).toBeInTheDocument()
    );
  });

  it('shows an error state (distinct from empty) when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    render(<CameraImageHistory webcamId={42} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t load captures/i)).toBeInTheDocument()
    );
  });
});
