// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const uploadCameraSnapshotMock = vi.fn();
const insertCameraSnapshotRowMock = vi.fn();
const sqlMock = vi.fn();
const invalidateTerminatorPayloadMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({
  verifyDeviceToken: (...args: unknown[]) => verifyDeviceTokenMock(...args),
}));
vi.mock('@/app/lib/cameraSnapshot', () => ({
  uploadCameraSnapshot: (...args: unknown[]) =>
    uploadCameraSnapshotMock(...args),
  insertCameraSnapshotRow: (...args: unknown[]) =>
    insertCameraSnapshotRowMock(...args),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));
vi.mock('@/app/lib/cache', () => ({
  invalidateTerminatorPayload: (...args: unknown[]) =>
    invalidateTerminatorPayloadMock(...args),
}));

import { POST } from './route';

const MAX_BYTES = 5 * 1024 * 1024;

function makeRequest(opts: {
  bearer?: string;
  imageBytes?: Buffer;
  fields?: Record<string, string>;
}) {
  const form = new FormData();
  const fields = {
    captured_at: '2026-05-03T01:32:14.000Z',
    phase: 'sunset',
    window_id: '2026-05-03-sunset-cam42',
    ...(opts.fields ?? {}),
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (opts.imageBytes) {
    form.append(
      'image',
      new Blob([opts.imageBytes], { type: 'image/jpeg' }),
      'frame.jpg'
    );
  }
  const headers: HeadersInit = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/api/cameras/42/snapshot', {
    method: 'POST',
    body: form,
    headers,
  });
}

describe('POST /api/cameras/[id]/snapshot', () => {
  beforeEach(() => {
    verifyDeviceTokenMock.mockReset();
    uploadCameraSnapshotMock.mockReset();
    insertCameraSnapshotRowMock.mockReset();
    sqlMock.mockReset();
    invalidateTerminatorPayloadMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns 401 when token verification fails', async () => {
    verifyDeviceTokenMock.mockResolvedValue(null);
    const req = makeRequest({
      bearer: 'bad',
      imageBytes: Buffer.from('jpeg'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 when image field is missing', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    const req = makeRequest({ bearer: 'good' });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(400);
  });

  it('returns 413 when image exceeds 5MB', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    const big = Buffer.alloc(MAX_BYTES + 1, 0);
    const req = makeRequest({ bearer: 'good', imageBytes: big });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(413);
  });

  it('returns 404 when camera has no paired webcam_id', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: null }]);
    const req = makeRequest({
      bearer: 'good',
      imageBytes: Buffer.from('jpeg'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(404);
  });

  it('returns 202 with snapshot_id on success', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    uploadCameraSnapshotMock.mockResolvedValue({
      url: 'https://example.com/x.jpg',
      path: 'snapshots/custom/42/1.jpg',
    });
    insertCameraSnapshotRowMock.mockResolvedValue(78901);

    const req = makeRequest({
      bearer: 'good',
      imageBytes: Buffer.from('jpeg-bytes'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.snapshot_id).toBe(78901);
    expect(body.accepted_at).toBeTruthy();

    expect(uploadCameraSnapshotMock).toHaveBeenCalledWith(
      42,
      expect.any(Buffer),
      expect.any(Date)
    );
    expect(insertCameraSnapshotRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webcamId: 10042,
        phase: 'sunset',
        windowId: '2026-05-03-sunset-cam42',
        firebaseUrl: 'https://example.com/x.jpg',
        firebasePath: 'snapshots/custom/42/1.jpg',
      })
    );
    expect(invalidateTerminatorPayloadMock).toHaveBeenCalledTimes(1);
  });

  it('does not 500 the ingest when cache invalidation fails', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    uploadCameraSnapshotMock.mockResolvedValue({
      url: 'https://example.com/x.jpg',
      path: 'snapshots/custom/42/1.jpg',
    });
    insertCameraSnapshotRowMock.mockResolvedValue(78902);
    invalidateTerminatorPayloadMock.mockRejectedValue(new Error('redis down'));

    const req = makeRequest({
      bearer: 'good',
      imageBytes: Buffer.from('jpeg-bytes'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.snapshot_id).toBe(78902);
  });
});
