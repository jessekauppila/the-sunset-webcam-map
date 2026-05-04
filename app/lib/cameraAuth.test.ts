import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { verifyDeviceToken, hashDeviceToken } from './cameraAuth';

describe('hashDeviceToken', () => {
  it('produces a 64-char lowercase hex SHA-256', () => {
    const out = hashDeviceToken('hello');
    expect(out).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});

describe('verifyDeviceToken', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns null when authorization header is missing', async () => {
    const result = await verifyDeviceToken(42, null);
    expect(result).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns null when header does not start with Bearer', async () => {
    const result = await verifyDeviceToken(42, 'Basic abc');
    expect(result).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns null when no camera row matches', async () => {
    sqlMock.mockResolvedValue([]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });

  it('returns null when camera is revoked', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 42,
        status: 'revoked',
        device_token_hash: hashDeviceToken('plaintext-token'),
      },
    ]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });

  it('returns the camera row when token hash matches and status is active', async () => {
    const row = {
      id: 42,
      status: 'active',
      device_token_hash: hashDeviceToken('plaintext-token'),
    };
    sqlMock.mockResolvedValue([row]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toEqual(row);
  });

  it('returns null when token hash mismatches', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 42,
        status: 'active',
        device_token_hash: hashDeviceToken('different-token'),
      },
    ]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });
});
