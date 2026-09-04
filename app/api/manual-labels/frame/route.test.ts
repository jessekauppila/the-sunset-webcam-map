// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const sqlMock = vi.fn();
const requireOwnerMock = vi.fn();
const upsertManualLabelMock = vi.fn();
const captureWebcamSnapshotMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => sqlMock(strings, ...values),
}));

// Guard pulls in real Auth.js/Google at import otherwise.
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

vi.mock('@/app/lib/manualLabels', () => ({
  upsertManualLabel: (...a: unknown[]) => upsertManualLabelMock(...a),
  countManualLabels: async () => 271,
}));

vi.mock('@/app/lib/webcamSnapshot', () => ({
  captureWebcamSnapshot: (...a: unknown[]) => captureWebcamSnapshotMock(...a),
}));

import { ARCHIVE_ORIGIN, LIVE_ORIGIN } from '@/app/lib/frameLabels';
import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://test/api/manual-labels/frame', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const good = { webcamId: 12, phase: 'sunset', isSunset: true, rating: 4 };

/** Match one of the template-literal queries the route ran. */
const queryMatching = (re: RegExp) =>
  sqlMock.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join('?').match(re));

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  requireOwnerMock.mockReset().mockResolvedValue(null);
  upsertManualLabelMock.mockReset().mockResolvedValue({ id: 5, labeledAt: '2026-09-03T00:00:00Z' });
  captureWebcamSnapshotMock.mockReset().mockResolvedValue({ url: 'https://s/g.jpg', path: 'g.jpg' });
});

describe('POST /api/manual-labels/frame', () => {
  it('is owner-gated before it touches the database', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    );
    const res = await POST(post({ ...good, frameId: 900 }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(upsertManualLabelMock).not.toHaveBeenCalled();
  });

  it('labels an archived frame by id without capturing anything', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 900, firebase_url: 'https://s/a.jpg', captured_at: '2026-06-21T03:00:00Z' },
    ]);

    const res = await POST(post({ ...good, frameId: 900 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(captureWebcamSnapshotMock).not.toHaveBeenCalled();
    expect(upsertManualLabelMock).toHaveBeenCalledWith({
      source: 'webcam', imageId: 900, isSunset: true, rating: 4, origin: ARCHIVE_ORIGIN,
    });
    expect(body.frameId).toBe(900);
    expect(body.captured).toBe(false);
    expect(body.labeledTotal).toBe(271);
  });

  it('refuses a frame id belonging to a different webcam', async () => {
    sqlMock.mockResolvedValueOnce([]); // the id + webcam_id lookup finds nothing
    const res = await POST(post({ ...good, frameId: 900 }));
    expect(res.status).toBe(404);
    expect(upsertManualLabelMock).not.toHaveBeenCalled();
  });

  it('scopes the frame lookup to the webcam, so an id alone cannot name a frame', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 900, firebase_url: 'https://s/a.jpg', captured_at: '2026-06-21T03:00:00Z' },
    ]);
    await POST(post({ ...good, frameId: 900 }));
    const call = queryMatching(/FROM webcam_snapshots/i);
    expect(call).toBeDefined();
    expect((call![0] as TemplateStringsArray).join('?')).toMatch(/webcam_id\s*=/i);
  });

  it('captures the frame when the caller has no id, and stamps the live origin', async () => {
    sqlMock
      .mockResolvedValueOnce([])                                   // no recent row to reuse
      .mockResolvedValueOnce([{ id: 12, images: { current: { preview: 'https://w/p.jpg' } }, rank: 3 }])
      .mockResolvedValueOnce([
        { id: 1001, firebase_url: 'https://s/g.jpg', captured_at: '2026-09-03T01:00:00Z' },
      ]);

    const res = await POST(post(good));
    const body = await res.json();

    expect(captureWebcamSnapshotMock).toHaveBeenCalled();
    expect(upsertManualLabelMock).toHaveBeenCalledWith({
      source: 'webcam', imageId: 1001, isSunset: true, rating: 4, origin: LIVE_ORIGIN,
    });
    expect(body.captured).toBe(true);
    // The surface shows the operator which image their judgment landed on.
    expect(body.frameUrl).toBe('https://s/g.jpg');
  });

  it('stamps the captured row so the ungated operator arm stays separable', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, images: { current: { preview: 'https://w/p.jpg' } }, rank: 3 }])
      .mockResolvedValueOnce([
        { id: 1001, firebase_url: 'https://s/g.jpg', captured_at: '2026-09-03T01:00:00Z' },
      ]);
    await POST(post(good));
    const insert = queryMatching(/INSERT INTO webcam_snapshots/i);
    expect(insert).toBeDefined();
    expect((insert![0] as TemplateStringsArray).join('?')).toMatch(/'operator_label'/);
  });

  it('never writes a public star row', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 900, firebase_url: 'https://s/a.jpg', captured_at: '2026-06-21T03:00:00Z' },
    ]);
    await POST(post({ ...good, frameId: 900 }));
    expect(queryMatching(/webcam_snapshot_ratings/i)).toBeUndefined();
    expect(queryMatching(/calculated_rating/i)).toBeUndefined();
    expect(queryMatching(/initial_rating/i)).toBeUndefined();
  });

  it('reuses a frame captured moments ago rather than uploading twice', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 1001, firebase_url: 'https://s/g.jpg', captured_at: '2026-09-03T01:00:00Z' },
    ]);
    const res = await POST(post({ ...good, rating: 2 }));
    expect(res.status).toBe(200);
    expect(captureWebcamSnapshotMock).not.toHaveBeenCalled();
    expect(upsertManualLabelMock).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: 1001, rating: 2 })
    );
  });

  it('stores a not-a-sunset verdict with no quality', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 900, firebase_url: 'https://s/a.jpg', captured_at: '2026-06-21T03:00:00Z' },
    ]);
    const res = await POST(post({ webcamId: 12, phase: 'sunset', frameId: 900, isSunset: false }));
    expect(res.status).toBe(200);
    expect(upsertManualLabelMock).toHaveBeenCalledWith(
      expect.objectContaining({ isSunset: false, rating: null })
    );
  });

  it('rejects a quality score attached to a not-a-sunset verdict', async () => {
    const res = await POST(
      post({ webcamId: 12, phase: 'sunset', frameId: 900, isSunset: false, rating: 3 })
    );
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a sunset with no quality, and a quality outside 1-5', async () => {
    expect((await POST(post({ webcamId: 12, phase: 'sunset', isSunset: true }))).status).toBe(400);
    expect((await POST(post({ ...good, rating: 6 }))).status).toBe(400);
    expect((await POST(post({ ...good, rating: 2.5 }))).status).toBe(400);
  });

  it('rejects a missing or unknown phase', async () => {
    expect((await POST(post({ webcamId: 12, isSunset: true, rating: 3 }))).status).toBe(400);
    expect((await POST(post({ ...good, phase: 'noon' }))).status).toBe(400);
  });

  it('reports a failed label write instead of claiming a save', async () => {
    upsertManualLabelMock.mockResolvedValue(null);
    sqlMock.mockResolvedValueOnce([
      { id: 900, firebase_url: 'https://s/a.jpg', captured_at: '2026-06-21T03:00:00Z' },
    ]);
    const res = await POST(post({ ...good, frameId: 900 }));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBeUndefined();
  });

  it('reports a capture that produced no image', async () => {
    captureWebcamSnapshotMock.mockResolvedValue(null);
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12, images: null, rank: null }]);
    const res = await POST(post(good));
    expect(res.status).toBe(500);
    expect(upsertManualLabelMock).not.toHaveBeenCalled();
  });
});
