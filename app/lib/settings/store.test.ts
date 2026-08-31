// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  transaction: unknown;
  __sqlMock: unknown;
  __txnMock: unknown;
};

vi.mock('@/app/lib/db', async () => {
  const sqlMockFn = vi.fn();
  const txnMockFn = vi.fn();

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMockFn(strings, ...values);
  const tagWithMocks = tag as unknown as SqlTag;
  tagWithMocks.transaction = txnMockFn;
  tagWithMocks.__sqlMock = sqlMockFn;
  tagWithMocks.__txnMock = txnMockFn;

  return { sql: tag };
});

import { getProfileSettings, putStudioNamespace, copyProfile } from './store';
import { sql } from '@/app/lib/db';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const txnMock = (sql as unknown as SqlTag).__txnMock;

beforeEach(() => {
  sqlMock.mockReset();
  txnMock.mockReset();
});

describe('getProfileSettings', () => {
  it('folds rows into a namespace map with the max revision', async () => {
    sqlMock.mockResolvedValueOnce([
      { namespace: 'shared', data: { activeVersion: 'v1' }, revision: 3 },
      { namespace: 'v1', data: { floorPx: 140 }, revision: 7 },
    ]);
    expect(await getProfileSettings('live')).toEqual({
      namespaces: { shared: { activeVersion: 'v1' }, v1: { floorPx: 140 } },
      revision: 7,
    });
  });
  it('returns an empty profile at revision 0 when no rows exist', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getProfileSettings('studio')).toEqual({ namespaces: {}, revision: 0 });
  });
});

describe('putStudioNamespace', () => {
  it('upserts deviations and returns the bumped revision', async () => {
    sqlMock.mockResolvedValueOnce([{ revision: 8 }]);
    expect(await putStudioNamespace('v1', { floorPx: 140 })).toBe(8);
    const [strings] = sqlMock.mock.calls[0];
    expect(strings.join('?')).toContain('ON CONFLICT');
  });
  it('deletes the row when every knob is back at default, keeping storage deviations-only', async () => {
    sqlMock.mockResolvedValueOnce([]);   // DELETE
    sqlMock.mockResolvedValueOnce([{ max: 5 }]); // revision re-read
    expect(await putStudioNamespace('v1', {})).toBe(5);
    const [strings] = sqlMock.mock.calls[0];
    expect(strings.join('?')).toContain('DELETE FROM kiosk_settings');
  });
});

describe('copyProfile', () => {
  it('runs prune + upsert in one transaction, then returns the new target state', async () => {
    // Mock the two sql calls within the transaction array
    sqlMock.mockResolvedValueOnce([]);   // DELETE result
    sqlMock.mockResolvedValueOnce([]);   // INSERT result
    txnMock.mockResolvedValueOnce([[], []]);
    // Mock the sql call in getProfileSettings after transaction
    sqlMock.mockResolvedValueOnce([
      { namespace: 'v1', data: { floorPx: 140 }, revision: 15 },
    ]);
    const result = await copyProfile('studio', 'live');
    expect(txnMock).toHaveBeenCalledTimes(1);
    expect(result.revision).toBe(15);
  });
});
