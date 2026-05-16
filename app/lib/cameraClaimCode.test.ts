// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  mintClaimCode,
  getClaimCode,
  consumeClaimCode,
  CLAIM_CODE_PATTERN,
} from './cameraClaimCode';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('mintClaimCode', () => {
  it('generates a code matching SUNSET-XXXX-XXXX and inserts it', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-7K3M-9XQ2',
        expires_at: new Date('2026-06-15T00:00:00Z'),
      },
    ]);

    const result = await mintClaimCode({ label: 'rooftop-1' });

    expect(result.code).toMatch(CLAIM_CODE_PATTERN);
    expect(result.expires_at).toBeInstanceOf(Date);
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it('uses an unambiguous alphabet (no O/0/I/1/L)', async () => {
    sqlMock.mockResolvedValue([
      { code: 'ignored', expires_at: new Date() },
    ]);
    for (let i = 0; i < 50; i++) {
      const r = await mintClaimCode({ label: null });
      expect(r.code).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('getClaimCode', () => {
  it('returns the row when it exists', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-AAAA-BBBB',
        label: 'test',
        expires_at: new Date('2099-01-01'),
        consumed_at: null,
        consumed_by_camera_id: null,
      },
    ]);
    const row = await getClaimCode('SUNSET-AAAA-BBBB');
    expect(row?.code).toBe('SUNSET-AAAA-BBBB');
    expect(row?.consumed_at).toBeNull();
  });

  it('returns null when the code does not exist', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const row = await getClaimCode('SUNSET-XXXX-XXXX');
    expect(row).toBeNull();
  });
});

describe('consumeClaimCode', () => {
  it('marks the code consumed and returns the updated row', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-AAAA-BBBB',
        consumed_at: new Date(),
        consumed_by_camera_id: 42,
      },
    ]);
    const row = await consumeClaimCode('SUNSET-AAAA-BBBB', 42);
    expect(row?.consumed_by_camera_id).toBe(42);
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it('returns null when the code is already consumed', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const row = await consumeClaimCode('SUNSET-AAAA-BBBB', 42);
    expect(row).toBeNull();
  });
});
