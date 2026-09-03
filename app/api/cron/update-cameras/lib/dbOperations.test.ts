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
  insertWindyDisagreementSnapshot,
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

describe('insertWindyDisagreementSnapshot', () => {
  const baseOpts = {
    webcamId: 700,
    phase: 'sunset' as const,
    firebaseUrl: 'https://stub-firebase/test.jpg',
    firebasePath: 'snapshots/700/test.jpg',
    aiRating: 4.1,
    aiRegressionScore: 0.78,
    aiModelVersionRegression: 'v4-regression',
    scoringPath: 'onnx',
    disagreementKind: 'binary_negative_regression_high',
  };

  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([{ id: 999 }]);
  });

  it('persists the binary head evidence columns when provided', async () => {
    await insertWindyDisagreementSnapshot({
      ...baseOpts,
      aiBinaryScore: 0.12,
      aiBinaryIsSunset: false,
      aiModelVersionBinary: 'v4-binary',
    });

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const query = (sqlMock.mock.calls[0][0] as readonly string[]).join(' ');
    expect(query).toContain('ai_binary_score');
    expect(query).toContain('ai_binary_is_sunset');
    expect(query).toContain('ai_model_version_binary');
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain(0.12);
    expect(values).toContain(false);
    expect(values).toContain('v4-binary');
  });

  it('stamps intake_reason so the unbiased trickle arm stays separable', async () => {
    await insertWindyDisagreementSnapshot({
      ...baseOpts,
      disagreementKind: null,
      intakeReason: 'trickle',
    });

    const query = (sqlMock.mock.calls[0][0] as readonly string[]).join(' ');
    expect(query).toContain('intake_reason');
    expect(sqlMock.mock.calls[0].slice(1)).toContain('trickle');
  });

  it('writes NULL intake_reason when the caller does not supply one', async () => {
    // Other write paths (backfills, custom cams) share this insert; a guessed
    // reason would pollute the column the trickle analysis filters on.
    await insertWindyDisagreementSnapshot(baseOpts);

    const query = (sqlMock.mock.calls[0][0] as readonly string[]).join(' ');
    expect(query).toContain('intake_reason');
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).not.toContain('trickle');
    expect(values).not.toContain('high_rated');
  });

  it('writes NULL binary columns when the binary head is not configured', async () => {
    await insertWindyDisagreementSnapshot(baseOpts);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const values = sqlMock.mock.calls[0].slice(1);
    // Three explicit nulls: score, is_sunset, model version.
    expect(values.filter((v) => v === null).length).toBeGreaterThanOrEqual(3);
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
  const GRACE_MS = 20 * 60_000;

  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it('deactivates rows of any source not in the active set', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // The SQL template-tag invocation should NOT reference w.source = 'windy'.
    const firstCallStrings = sqlMock.mock.calls[0][0] as readonly string[];
    expect(firstCallStrings.join(' ')).not.toContain("source = 'windy'");
  });

  it('deactivates only aged-out rows when the active set is empty', async () => {
    await deactivateMissingTerminatorState('sunset', [], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const strings = sqlMock.mock.calls[0][0] as readonly string[];
    const fullQuery = strings.join(' ');
    expect(fullQuery).not.toContain("source = 'windy'");
    // Empty-array fast path: no `<> all` filter ...
    expect(fullQuery).not.toContain('<> all');
    // ... but the grace still applies. An empty sweep used to empty the feed.
    // Assert the whole fragment, not just `last_seen_at <` — that would
    // still pass if the sign flipped to `now() + graceMs`, which would
    // deactivate the entire pool every tick.
    expect(fullQuery.replace(/\s+/g, ' ')).toContain('last_seen_at < now() - ');
  });

  it('passes the active ids array into the SQL parameters', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // Index 0 of the call is the TemplateStringsArray; rest are interpolated values.
    const values = sqlMock.mock.calls[0].slice(1);
    // The phase string and the active-ids array should both appear in values.
    expect(values).toContain('sunrise');
    expect(values.some((v) => Array.isArray(v) && (v as number[]).join(',') === '42,99')).toBe(true);
  });

  it('applies the grace to the non-empty branch too', async () => {
    await deactivateMissingTerminatorState('sunrise', [42], GRACE_MS);

    const strings = sqlMock.mock.calls[0][0] as readonly string[];
    // Assert the whole fragment, not just `last_seen_at <` — that would
    // still pass if the sign flipped to `now() + graceMs`, which would
    // deactivate the entire pool every tick.
    expect(strings.join(' ').replace(/\s+/g, ' ')).toContain('last_seen_at < now() - ');
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain(GRACE_MS);
  });
});
