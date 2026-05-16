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
  generateClaimCode,
  CLAIM_CODE_PATTERN,
} from './cameraClaimCode';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('generateClaimCode', () => {
  it('matches CLAIM_CODE_PATTERN on every call', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateClaimCode()).toMatch(CLAIM_CODE_PATTERN);
    }
  });

  it('never produces ambiguous characters (0/O/1/I/L)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateClaimCode()).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('mintClaimCode', () => {
  it('generates a code matching the pattern and inserts it', async () => {
    sqlMock.mockResolvedValueOnce([
      { code: 'SUNSET-7K3M-9XQ2', expires_at: new Date('2026-06-15T00:00:00Z') },
    ]);
    const result = await mintClaimCode({ label: 'rooftop-1' });
    expect(result.expires_at).toBeInstanceOf(Date);
    expect(sqlMock).toHaveBeenCalledOnce();
    const generatedCode = sqlMock.mock.calls[0][1] as string;
    expect(generatedCode).toMatch(CLAIM_CODE_PATTERN);
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
