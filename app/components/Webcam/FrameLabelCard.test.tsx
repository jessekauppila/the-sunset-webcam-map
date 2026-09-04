import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FrameLabelCard } from './FrameLabelCard';
import type { WindyWebcam } from '@/app/lib/types';

const cam = (over: Partial<WindyWebcam> = {}): WindyWebcam =>
  ({ webcamId: 12, title: 'Cam', phase: 'sunset', location: {}, categories: [], ...over } as
    unknown as WindyWebcam);

const okResponse = (over: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({
    ok: true,
    saved: { id: 5, labeledAt: '2026-09-03T00:00:00Z' },
    frameId: 900, frameUrl: 'https://s/a.jpg', capturedAt: '2026-09-03T00:00:00Z',
    captured: false, origin: 'operator_archive', labeledTotal: 271,
    ...over,
  }),
});

let fetchMock: ReturnType<typeof vi.fn>;

/** Rating 4 on the shared star widget — the stars are radios, 1-indexed. */
const clickFourStars = () => fireEvent.click(screen.getAllByRole('radio')[3]);

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FrameLabelCard', () => {
  it('writes a gold label and nothing else', async () => {
    render(<FrameLabelCard webcam={cam({ frameId: 900 })} />);
    clickFourStars();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/manual-labels/frame');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      webcamId: 12, phase: 'sunset', frameId: 900, isSunset: true, rating: 4,
    });
    // One request, one destination. No public star write rides along.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('names the frame from the record it was handed, not from live state', async () => {
    const { rerender } = render(<FrameLabelCard webcam={cam({ frameId: 900 })} />);
    // A newer pool arrives for a DIFFERENT camera while the card is open.
    rerender(<FrameLabelCard webcam={cam({ webcamId: 77, frameId: 4242 })} />);
    clickFourStars();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ webcamId: 77, frameId: 4242 });
  });

  it('omits the frame id for a live tile so the server captures one', async () => {
    render(<FrameLabelCard webcam={cam()} />);
    clickFourStars();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.frameId).toBeUndefined();
  });

  it('sends a not-a-sunset verdict with no quality', async () => {
    render(<FrameLabelCard webcam={cam({ frameId: 900 })} />);
    fireEvent.click(screen.getByRole('button', { name: /not a sunset/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ isSunset: false, rating: null });
  });

  it('says when the frame had to be captured to be labeled', async () => {
    fetchMock.mockResolvedValue(okResponse({ captured: true, origin: 'operator_live' }));
    render(<FrameLabelCard webcam={cam()} />);
    clickFourStars();

    await screen.findByText(/captured this frame/i);
  });

  it('reports a refused write instead of showing a save', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'frame not found for this webcam' }),
    });
    render(<FrameLabelCard webcam={cam({ frameId: 900 })} />);
    clickFourStars();

    await screen.findByText(/frame not found for this webcam/i);
  });

  it('hands the surface the result so it can advance or stay put', async () => {
    const onLabeled = vi.fn();
    render(<FrameLabelCard webcam={cam({ frameId: 900 })} onLabeled={onLabeled} />);
    clickFourStars();

    await waitFor(() => expect(onLabeled).toHaveBeenCalled());
    expect(onLabeled.mock.calls[0][0]).toMatchObject({ frameId: 900, labeledTotal: 271 });
  });

  it('refuses to label at all when there is no frame and none may be captured', () => {
    render(<FrameLabelCard webcam={cam()} allowCapture={false} />);
    expect(screen.queryByRole('button', { name: /not a sunset/i })).toBeNull();
    expect(screen.getByText(/nothing to label/i)).toBeTruthy();
  });
});
