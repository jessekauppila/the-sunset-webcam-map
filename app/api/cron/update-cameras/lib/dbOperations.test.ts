import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { deactivateMissingTerminatorState } from './dbOperations';

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
