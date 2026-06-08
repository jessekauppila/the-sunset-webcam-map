import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { upsertManualLabel, deleteManualLabel } from './manualLabels';

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
});
