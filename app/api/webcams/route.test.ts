import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

describe('API Route Test', () => {
  it('should return webcam data in correct format', async () => {
    // Mock fetch to return fake webcam data (like Windy would)
    const mockWindyData = [
      { webcamId: 123, title: 'Test Webcam', status: 'active' },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockWindyData,
    });

    // Call our API (URL doesn't matter for testing)
    const request = new NextRequest('http://test.com/api/webcams');
    const response = await GET(request);
    const data = await response.json();

    // ✅ Check status
    expect(response.status).toBe(200);

    // ✅ Check data structure
    expect(data).toHaveProperty('webcams');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('source');

    // ✅ Check actual values
    expect(data.webcams).toEqual(mockWindyData);
    expect(data.total).toBe(1);
    expect(data.source).toBe('windy');
  });

  it('should handle API errors', async () => {
    // Mock a failed API call
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const request = new NextRequest('http://test.com/api/webcams');
    const response = await GET(request);
    const data = await response.json();

    // ✅ Check error response
    expect(response.status).toBe(401);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Windy API error: 401');
  });

  it('clamps the query box to the bounds Windy accepts', async () => {
    // A user-panned map near the pole and across the antimeridian produces
    // northLat > 90 and eastLon > 180. Windy 400s on either, and the route
    // surfaces that as "no results" rather than as an error, so the failure
    // is invisible. Clamping shrinks the box and keeps the call.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = fetchMock;

    const request = new NextRequest(
      'http://test.com/api/webcams?centerLat=85&centerLng=175&boxSize=11',
    );
    await GET(request);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('northLat=90');
    expect(url).toContain('southLat=74');
    expect(url).toContain('eastLon=180');
    expect(url).toContain('westLon=164');
  });
});
