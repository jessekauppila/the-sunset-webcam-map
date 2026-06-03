// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Replace the whole auth module so next-auth/Google never load in the test.
vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { requireOwner, isOwner } from './owner';
import type { Session } from 'next-auth';

const mockAuth = vi.mocked(auth);
const ORIG = process.env.OWNER_EMAILS;

beforeEach(() => {
  process.env.OWNER_EMAILS = 'owner@example.com';
});
afterEach(() => {
  vi.clearAllMocks();
  if (ORIG === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = ORIG;
});

const session = (email: string | null): Session =>
  ({ user: { email }, expires: '' }) as Session;

describe('requireOwner (route guard shared by every mutating route)', () => {
  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await requireOwner();
    expect(res?.status).toBe(401);
  });

  it('returns 403 when signed in but not the allow-listed owner', async () => {
    mockAuth.mockResolvedValue(session('someone@else.com'));
    const res = await requireOwner();
    expect(res?.status).toBe(403);
  });

  it('allows (returns null) for the allow-listed owner, case-insensitively', async () => {
    mockAuth.mockResolvedValue(session('Owner@Example.com'));
    const res = await requireOwner();
    expect(res).toBeNull();
  });
});

describe('isOwner', () => {
  it('is false for a null session and true for the allow-listed owner', () => {
    expect(isOwner(null)).toBe(false);
    expect(isOwner(session('owner@example.com'))).toBe(true);
    expect(isOwner(session('nope@x.io'))).toBe(false);
  });
});
