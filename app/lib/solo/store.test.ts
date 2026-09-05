// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  __sqlMock: ReturnType<typeof vi.fn>;
};
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', async () => {
  const sqlMockFn = vi.fn();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => sqlMockFn(strings, ...values);
  (tag as unknown as SqlTag).__sqlMock = sqlMockFn;
  return { sql: tag };
});

import { sql } from '@/app/lib/db';
import {
  listActiveEntries, insertEntry, removeStale, getScreenState, commitAdvance,
  countAdmittedSince, getBinDigestSummary,
} from './store';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const lastQuery = () => (sqlMock.mock.calls.at(-1)![0] as TemplateStringsArray).join('?');

beforeEach(() => sqlMock.mockReset());

describe('listActiveEntries', () => {
  it('maps rows into StoredEntry with numbers, not Neon strings', async () => {
    sqlMock.mockResolvedValueOnce([{
      snapshot_id: '7', webcam_id: '3', bin: 'sunset', quality: '0.91', detection: '0.88',
      is_new: true, tally: '2', entered_at: '2026-09-04T01:00:00Z', first_shown_at: null, last_shown_at: null,
      firebase_url: 'https://storage.googleapis.com/x.jpg', title: 'Pier', city: 'Lisbon', region: 'Lisboa',
      country: 'Portugal', lat: '38.700000', lng: '-9.400000',
    }]);
    const [e] = await listActiveEntries('sunset');
    expect(e).toMatchObject({ snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.91, detection: 0.88,
      isNew: true, tally: 2, feed: 'sunset', lat: 38.7, lng: -9.4, imageUrl: 'https://storage.googleapis.com/x.jpg' });
    expect(e.enteredAt).toBe(Date.parse('2026-09-04T01:00:00Z'));
    expect(lastQuery()).toMatch(/removed_at is null/i);
  });
});

describe('insertEntry', () => {
  it('returns true on insert and false on conflict', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    expect(await insertEntry({ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, quality: 0.9, detection: 0.8, isNew: false })).toBe(true);
    expect(lastQuery()).toMatch(/on conflict \(feed, snapshot_id\) do nothing/i);
    sqlMock.mockResolvedValueOnce([]);
    expect(await insertEntry({ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, quality: 0.9, detection: 0.8, isNew: false })).toBe(false);
  });
});

describe('removeStale', () => {
  it('removes past-grace as left_zone and past-age as expired, and counts each', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }]);
    expect(await removeStale('sunrise', { grace: 2, maxAgeHours: 24 })).toEqual({ leftZone: 2, expired: 1 });
    const q1 = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(q1).toMatch(/out_of_zone_polls > \?/);
    expect(sqlMock.mock.calls[0].slice(1)).toContain(2);
    expect(q1).toMatch(/'left_zone'/);
  });
});

describe('screen state', () => {
  it('getScreenState returns null when the row is absent', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getScreenState('sunset')).toBeNull();
  });
  it('commitAdvance is a no-op when the slot was already committed', async () => {
    sqlMock.mockResolvedValueOnce([]); // upsert returned nothing: slot unchanged
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(false);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
  it('commitAdvance bumps the tally after a successful state write', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]);
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toMatch(/tally = tally \+ 1/);
    expect(lastQuery()).toMatch(/is_new = false/);
  });
});

describe('counts', () => {
  it('countAdmittedSince returns numbers per bin', async () => {
    sqlMock.mockResolvedValueOnce([{ bin: 'sunset', n: '3' }, { bin: 'non_sunset', n: '5' }]);
    expect(await countAdmittedSince('sunset', 0)).toEqual({ sunset: 3, nonSunset: 5 });
  });
  it('getBinDigestSummary swallows its own failure', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await getBinDigestSummary()).toBeNull();
  });
});
