import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWebcamFetch } from './useWebCamFetch';
import { SEARCH_RADIUS_DEG } from '@/app/lib/terminatorConfig';

// Mock fetch globally
global.fetch = vi.fn();

describe('useWebcamFetch Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testLat = 51.5074; // London
  const testLng = -0.1278;

  it('should use provided coordinates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ webcams: [], total: 0, source: 'windy' }),
    } as Response);

    renderHook(() => useWebcamFetch(testLat, testLng));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `centerLat=${testLat}&centerLng=${testLng}`
        )
      );
    });
  });

  it('should fetch webcams from API route', async () => {
    // Mock successful API response

    const mockResponse = {
      webcams: [
        { webcamId: 123, title: 'Test Webcam', status: 'active' },
      ],
      total: 1,
      source: 'windy',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const { result } = renderHook(() =>
      useWebcamFetch(testLat, testLng)
    );

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.webcams).toEqual([]);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // ✅ Test the RESULT (not implementation)
    expect(result.current.webcams).toEqual(mockResponse.webcams);
    expect(result.current.totalCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('should call API with correct coordinates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ webcams: [], total: 0, source: 'windy' }),
    } as Response);

    renderHook(() => useWebcamFetch(testLat, testLng));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `centerLat=51.5074&centerLng=-0.1278&boxSize=${SEARCH_RADIUS_DEG}`
        )
      );
    });
  });
});
