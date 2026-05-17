import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { deactivateMissingTerminatorState, upsertTerminatorState } from './dbOperations';

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

  it('only touches windy-sourced rows when active list is empty', async () => {
    await deactivateMissingTerminatorState('sunset', []);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/source\s*=\s*'windy'/);
  });

  it('only touches windy-sourced rows when an active list is provided', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/source\s*=\s*'windy'/);
  });
});
