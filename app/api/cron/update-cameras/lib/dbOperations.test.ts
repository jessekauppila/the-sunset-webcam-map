import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  deactivateMissingTerminatorState,
  upsertTerminatorState,
  getWebcamImageHashMap,
  updateWebcamAiFields,
} from './dbOperations';

describe('getWebcamImageHashMap', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('returns a webcamId → last_image_hash map from the rows', async () => {
    sqlMock.mockResolvedValue([
      { id: 700, last_image_hash: 'hash-a' },
      { id: 800, last_image_hash: 'hash-b' },
    ]);

    const result = await getWebcamImageHashMap([700, 800]);

    expect(result.get(700)).toBe('hash-a');
    expect(result.get(800)).toBe('hash-b');
  });

  it('passes the webcam ids array into the SQL parameters', async () => {
    sqlMock.mockResolvedValue([]);

    await getWebcamImageHashMap([700, 800]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(
      values.some(
        (v) => Array.isArray(v) && (v as number[]).join(',') === '700,800',
      ),
    ).toBe(true);
  });

  it('returns an empty map without querying when given no ids', async () => {
    const result = await getWebcamImageHashMap([]);

    expect(result.size).toBe(0);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('updateWebcamAiFields', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue(undefined);
  });

  it('writes the last_image_hash value into the UPDATE parameters', async () => {
    await updateWebcamAiFields([
      {
        webcamId: 700,
        aiRating: 3,
        aiModelVersion: 'v4',
        aiRatingBinary: 3,
        aiModelVersionBinary: 'v4',
        aiRatingRegression: 3,
        aiModelVersionRegression: 'v4',
        lastImageHash: 'fresh-hash',
      },
    ]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain('fresh-hash');
  });
});

describe('upsertTerminatorState', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue(undefined);
  });

  it('upserts rows with pre-resolved DB webcam_id and array-index rank', async () => {
    await upsertTerminatorState(
      [
        { webcamId: 42 },
        { webcamId: 7 },
      ],
      'sunrise',
    );

    // One call per row; rank is the array index
    expect(sqlMock).toHaveBeenCalledTimes(2);

    // First call should carry webcamId=42 + rank=0 + phase='sunrise'.
    const firstCallValues = sqlMock.mock.calls[0].slice(1);
    expect(firstCallValues).toContain(42);
    expect(firstCallValues).toContain('sunrise');
    expect(firstCallValues).toContain(0);

    // Second call should carry webcamId=7 + rank=1 + phase='sunrise'.
    const secondCallValues = sqlMock.mock.calls[1].slice(1);
    expect(secondCallValues).toContain(7);
    expect(secondCallValues).toContain('sunrise');
    expect(secondCallValues).toContain(1);
  });
});

describe('deactivateMissingTerminatorState', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it('deactivates rows of any source not in the active set', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // The SQL template-tag invocation should NOT reference w.source = 'windy'.
    const firstCallStrings = sqlMock.mock.calls[0][0] as readonly string[];
    expect(firstCallStrings.join(' ')).not.toContain("source = 'windy'");
  });

  it('deactivates all rows for the phase when active set is empty', async () => {
    await deactivateMissingTerminatorState('sunset', []);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const strings = sqlMock.mock.calls[0][0] as readonly string[];
    const fullQuery = strings.join(' ');
    expect(fullQuery).not.toContain("source = 'windy'");
    // Empty-array fast path: no `<> all` filter.
    expect(fullQuery).not.toContain('<> all');
  });

  it('passes the active ids array into the SQL parameters', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // Index 0 of the call is the TemplateStringsArray; rest are interpolated values.
    const values = sqlMock.mock.calls[0].slice(1);
    // The phase string and the active-ids array should both appear in values.
    expect(values).toContain('sunrise');
    expect(values.some((v) => Array.isArray(v) && (v as number[]).join(',') === '42,99')).toBe(true);
  });
});
