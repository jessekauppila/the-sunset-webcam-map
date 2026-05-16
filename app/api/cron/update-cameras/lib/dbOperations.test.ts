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

    expect(sqlMock).toHaveBeenCalledTimes(2);

    // Verify the first call passes webcamId=42, phase='sunrise', rank=0
    const [, ...firstCallValues] = sqlMock.mock.calls[0];
    expect(firstCallValues).toContain(42);
    expect(firstCallValues).toContain('sunrise');
    expect(firstCallValues).toContain(0);

    // Verify the second call passes webcamId=7, phase='sunrise', rank=1
    const [, ...secondCallValues] = sqlMock.mock.calls[1];
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
