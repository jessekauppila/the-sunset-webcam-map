import { describe, it, expect } from 'vitest';
import { sha256Hex } from './imageHash';

describe('sha256Hex', () => {
  it('returns the SHA-256 hex digest of a buffer', () => {
    const buf = Buffer.from('hello', 'utf8');
    // Known sha256 of "hello"
    expect(sha256Hex(buf)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('is deterministic for identical bytes', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 3]);
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it('differs for different bytes', () => {
    const a = Buffer.from([0, 1, 2, 3]);
    const b = Buffer.from([0, 1, 2, 4]);
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});
