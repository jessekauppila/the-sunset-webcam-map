import { describe, it, expect, afterEach } from 'vitest';
import { ownerEmails, isAllowedOwnerEmail } from './ownerEmails';

const ORIG = process.env.OWNER_EMAILS;
afterEach(() => {
  if (ORIG === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = ORIG;
});

describe('owner allow-list', () => {
  it('parses a comma-separated list, lowercasing and trimming whitespace', () => {
    process.env.OWNER_EMAILS = ' Jesse@Example.com , second@x.io ';
    expect(ownerEmails()).toEqual(['jesse@example.com', 'second@x.io']);
  });

  it('allows an allow-listed email case-insensitively (owner)', () => {
    process.env.OWNER_EMAILS = 'jesse@example.com';
    expect(isAllowedOwnerEmail('JESSE@Example.com')).toBe(true);
  });

  it('rejects a non-allow-listed email (signed in, not owner)', () => {
    process.env.OWNER_EMAILS = 'jesse@example.com';
    expect(isAllowedOwnerEmail('someone@else.com')).toBe(false);
  });

  it('rejects null/undefined/empty (no session, or session without an email)', () => {
    process.env.OWNER_EMAILS = 'jesse@example.com';
    expect(isAllowedOwnerEmail(null)).toBe(false);
    expect(isAllowedOwnerEmail(undefined)).toBe(false);
    expect(isAllowedOwnerEmail('')).toBe(false);
  });

  it('rejects everything when OWNER_EMAILS is unset', () => {
    delete process.env.OWNER_EMAILS;
    expect(ownerEmails()).toEqual([]);
    expect(isAllowedOwnerEmail('jesse@example.com')).toBe(false);
  });
});
