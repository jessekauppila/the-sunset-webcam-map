import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const saveMock = vi.fn();
const makePublicMock = vi.fn();
const fileMock = vi.fn(() => ({ save: saveMock, makePublic: makePublicMock }));
const bucketMock = { name: 'sunrisesunset-32a25.firebasestorage.app', file: fileMock };

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

vi.mock('@/app/lib/firebase', () => ({
  getFirebaseBucket: () => bucketMock,
}));

import {
  uploadCameraSnapshot,
  insertCameraSnapshotRow,
} from './cameraSnapshot';

describe('uploadCameraSnapshot', () => {
  beforeEach(() => {
    saveMock.mockReset().mockResolvedValue(undefined);
    makePublicMock.mockReset().mockResolvedValue(undefined);
    fileMock.mockClear();
  });

  it('uploads to snapshots/custom/<id>/<ts>.jpg and returns public url', async () => {
    const buf = Buffer.from('fake-jpeg');
    const ts = new Date('2026-05-03T01:32:14.000Z');
    const result = await uploadCameraSnapshot(42, buf, ts);

    expect(fileMock).toHaveBeenCalledWith(
      `snapshots/custom/42/${ts.getTime()}.jpg`
    );
    expect(saveMock).toHaveBeenCalledWith(
      buf,
      expect.objectContaining({
        metadata: expect.objectContaining({ contentType: 'image/jpeg' }),
      })
    );
    expect(makePublicMock).toHaveBeenCalled();
    expect(result.path).toBe(`snapshots/custom/42/${ts.getTime()}.jpg`);
    expect(result.url).toBe(
      `https://storage.googleapis.com/${bucketMock.name}/${result.path}`
    );
  });
});

describe('insertCameraSnapshotRow', () => {
  beforeEach(() => sqlMock.mockReset());

  it('inserts a webcam_snapshots row and returns the id', async () => {
    sqlMock.mockResolvedValue([{ id: 12345 }]);

    const id = await insertCameraSnapshotRow({
      webcamId: 10042,
      phase: 'sunset',
      capturedAt: new Date('2026-05-03T01:32:14.000Z'),
      firebaseUrl: 'https://example.com/x.jpg',
      firebasePath: 'snapshots/custom/42/1.jpg',
      windowId: '2026-05-03-sunset-cam42',
      edgeScore: null,
      edgeModelVersion: null,
    });

    expect(id).toBe(12345);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/INSERT INTO webcam_snapshots/i);
    expect(values).toContain(10042);
    expect(values).toContain('sunset');
    expect(values).toContain('2026-05-03-sunset-cam42');
  });
});
