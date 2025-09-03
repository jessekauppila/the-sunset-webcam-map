import { renderHook, waitFor } from '@testing-library/react';
import { useSimpleWebCamFetch } from './useSimpleWebCamFetch';

// Mock fetch globally
global.fetch = vi.fn();

describe('useSimpleWebCamFetch Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { result } = renderHook(() => useSimpleWebCamFetch());

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

    renderHook(() => useSimpleWebCamFetch());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'centerLat=40.7128&centerLng=-74.006&boxSize=5'
        )
      );
    });
  });
});
