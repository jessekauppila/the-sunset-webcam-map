// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  transaction: unknown;
  __sqlMock: ReturnType<typeof vi.fn>;
  __txnMock: ReturnType<typeof vi.fn>;
};

vi.mock('@/app/lib/db', async () => {
  const sqlMockFn = vi.fn();
  const txnMockFn = vi.fn();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => sqlMockFn(strings, ...values);
  const t = tag as unknown as SqlTag;
  t.transaction = txnMockFn;
  t.__sqlMock = sqlMockFn;
  t.__txnMock = txnMockFn;
  return { sql: tag };
});

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_VERSIONS: { v1: {} },
  DEFAULT_MOSAIC_VERSION: 'v1',
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [{ key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' }],
  },
}));

import { recordDeploy, listDeploys, loadDeployIntoStudio, relabelDeploy } from './deploys';
import { sql } from '@/app/lib/db';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const txnMock = (sql as unknown as SqlTag).__txnMock;
const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
/** Answer each statement by a fragment of its text; anything else (the transaction's DELETE/INSERT tags) gets undefined. */
const byStatement = (answers: Record<string, unknown[]>) =>
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const t = strings.join('?');
    const hit = Object.keys(answers).find((k) => t.includes(k));
    return hit ? Promise.resolve(answers[hit]) : undefined;
  });

beforeEach(() => {
  sqlMock.mockReset();
  txnMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('recordDeploy', () => {
  it('inserts the whole profile and returns the row', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 7, label: null, namespaces: { v1: { floorPx: 140 } }, deployed_at: '2026-09-05T18:30:00.000Z' },
    ]);
    const row = await recordDeploy({ namespaces: { v1: { floorPx: 140 } }, revision: 3 }, null);
    expect(row).toEqual({
      id: 7, label: null, namespaces: { v1: { floorPx: 140 } }, deployedAt: '2026-09-05T18:30:00.000Z',
    });
    expect(text(sqlMock.mock.calls[0])).toContain('INSERT INTO kiosk_deploys');
    expect(sqlMock.mock.calls[0][2]).toBe(JSON.stringify({ v1: { floorPx: 140 } }));
  });
  it('returns null instead of throwing when the table is missing', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_deploys" does not exist'));
    expect(await recordDeploy({ namespaces: {}, revision: 1 })).toBeNull();
  });
});

describe('listDeploys', () => {
  it('maps rows newest first and defaults the limit to 50', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 2, label: 'b', namespaces: {}, deployed_at: '2026-09-05T18:30:00.000Z' },
      { id: 1, label: null, namespaces: {}, deployed_at: '2026-09-05T17:00:00.000Z' },
    ]);
    const rows = await listDeploys();
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(text(sqlMock.mock.calls[0])).toContain('ORDER BY id DESC');
    expect(sqlMock.mock.calls[0][1]).toBe(50);
  });
  it('returns [] when the read fails', async () => {
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    expect(await listDeploys()).toEqual([]);
  });
});

describe('loadDeployIntoStudio', () => {
  it('returns null for an unknown id', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await loadDeployIntoStudio(99)).toBeNull();
    expect(txnMock).not.toHaveBeenCalled();
  });
  it('replaces the studio profile wholesale, sanitizing through the current schema and naming what it dropped', async () => {
    // The transaction's tagged calls also go through sqlMock, so answer by statement, not by order.
    byStatement({
      'SELECT namespaces': [{ namespaces: { v1: { floorPx: 140, ghost: 1 }, gone: { x: 2 } } }],
      'SELECT namespace, data': [{ namespace: 'v1', data: { floorPx: 140 }, revision: 1 }],
    });
    const out = await loadDeployIntoStudio(7);
    expect(out?.studio).toEqual({ namespaces: { v1: { floorPx: 140 } }, revision: 1 });
    expect(out?.dropped).toEqual([
      { namespace: 'v1', key: 'ghost', reason: 'unknown' },
      { namespace: 'gone', key: 'x', reason: 'unknown' },
    ]);
    const [statements] = txnMock.mock.calls[0];
    expect(statements).toHaveLength(2); // DELETE every studio row, then one INSERT per surviving namespace
    const deleteCall = sqlMock.mock.calls.find((c) =>
      text(c).includes("DELETE FROM kiosk_settings WHERE profile = 'studio'"));
    expect(deleteCall).toBeDefined();
    const insertCall = sqlMock.mock.calls.find((c) => text(c).includes('INSERT INTO kiosk_settings'));
    expect(insertCall?.[1]).toBe('v1');
    expect(insertCall?.[2]).toBe(JSON.stringify({ floorPx: 140 }));
  });
  it('a namespace whose every value is at default is not written back', async () => {
    byStatement({ 'SELECT namespaces': [{ namespaces: { v1: { floorPx: 100 } } }], 'SELECT namespace, data': [] });
    const out = await loadDeployIntoStudio(3);
    expect(out?.studio).toEqual({ namespaces: {}, revision: 0 });
    expect(txnMock.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('relabelDeploy', () => {
  it('true when a row changed, false when none did', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    expect(await relabelDeploy(7, 'opening night')).toBe(true);
    sqlMock.mockResolvedValueOnce([]);
    expect(await relabelDeploy(8, null)).toBe(false);
  });
});
