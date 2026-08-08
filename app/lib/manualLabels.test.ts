import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { upsertManualLabel, deleteManualLabel, countManualLabels } from './manualLabels';

beforeEach(() => sqlMock.mockReset().mockResolvedValue([]));

describe('upsertManualLabel', () => {
  it('upserts on (source, image_id) and stamps labeled_at', async () => {
    await upsertManualLabel({ source: 'flickr', imageId: 7, isSunset: true, rating: 4 });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/insert\s+into\s+manual_labels/i);
    expect(q).toMatch(/on\s+conflict\s*\(source,\s*image_id\)\s+do\s+update/i);
    expect(q).toMatch(/labeled_at\s*=\s*now\(\)/i);
    expect(values).toContain('flickr');
    expect(values).toContain(7);
    expect(values).toContain(true);
    expect(values).toContain(4);
  });
  it('passes null rating when omitted', async () => {
    await upsertManualLabel({ source: 'webcam', imageId: 9, isSunset: false });
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(null);
  });
});

describe('deleteManualLabel', () => {
  it('deletes the (source, image_id) row', async () => {
    await deleteManualLabel('webcam', 9);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/delete\s+from\s+manual_labels/i);
    expect(values).toContain('webcam');
    expect(values).toContain(9);
  });

  it('reports how many rows were actually removed', async () => {
    sqlMock.mockResolvedValue([{ id: 5 }]);
    await expect(deleteManualLabel('webcam', 9)).resolves.toBe(1);
    sqlMock.mockResolvedValue([]);
    await expect(deleteManualLabel('webcam', 9)).resolves.toBe(0);
  });
});

// The queue treats these return values as proof the write landed, so an
// insert that stored nothing must be distinguishable from one that did.
describe('write confirmation', () => {
  it('returns the stored row so a save can be verified, not assumed', async () => {
    sqlMock.mockResolvedValue([{ id: '42', labeled_at: '2026-08-08T02:35:24.017Z' }]);
    await expect(
      upsertManualLabel({ source: 'webcam', imageId: 3, isSunset: true, rating: 5 }),
    ).resolves.toEqual({ id: 42, labeledAt: '2026-08-08T02:35:24.017Z' });
    expect(sqlMock.mock.calls[0][0].join('?')).toMatch(/returning\s+id,\s*labeled_at/i);
  });

  it('returns null when the insert stored no row', async () => {
    sqlMock.mockResolvedValue([]);
    await expect(
      upsertManualLabel({ source: 'webcam', imageId: 3, isSunset: true }),
    ).resolves.toBeNull();
  });

  it('counts the labels on record', async () => {
    sqlMock.mockResolvedValue([{ n: 113 }]);
    await expect(countManualLabels()).resolves.toBe(113);
  });
});
