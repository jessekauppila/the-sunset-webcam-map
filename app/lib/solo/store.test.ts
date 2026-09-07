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
  countAdmittedSince, getBinDigestSummary, saveSweptZone, getSweptZone, logDraw, listRecentDraws, pruneDraws,
  listDrawsBetween, listEntriesOverlapping,
} from './store';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const lastQuery = () => (sqlMock.mock.calls.at(-1)![0] as TemplateStringsArray).join('?');

beforeEach(() => sqlMock.mockReset());

describe('swept zone', () => {
  it('saveSweptZone upserts the single row the cron aged entries against', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await saveSweptZone({ minDeg: -39.75, maxDeg: 13.75 });
    expect(lastQuery()).toMatch(/kiosk_sweep_zone/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual([-39.75, 13.75]);
  });
  it('saveSweptZone never throws: an unmigrated table must not cost the tick its bins', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_sweep_zone" does not exist'));
    await expect(saveSweptZone({ minDeg: -24, maxDeg: -2 })).resolves.toBeUndefined();
  });
  it('getSweptZone maps Neon strings to numbers', async () => {
    sqlMock.mockResolvedValueOnce([{ min_deg: '-39.75', max_deg: '13.75' }]);
    expect(await getSweptZone()).toEqual({ minDeg: -39.75, maxDeg: 13.75 });
  });
  it('getSweptZone is null when the table is missing or empty', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_sweep_zone" does not exist'));
    expect(await getSweptZone()).toBeNull();
    sqlMock.mockResolvedValueOnce([]);
    expect(await getSweptZone()).toBeNull();
  });
});

describe('listActiveEntries', () => {
  it('maps rows into StoredEntry with numbers, not Neon strings', async () => {
    sqlMock.mockResolvedValueOnce([{
      snapshot_id: '7', webcam_id: '3', bin: 'sunset', quality: '0.91', detection: '0.88',
      is_new: true, tally: '2', entered_at: '2026-09-04T01:00:00Z', first_shown_at: null, last_shown_at: null,
      firebase_url: 'https://storage.googleapis.com/x.jpg', title: 'Pier', city: 'Lisbon', region: 'Lisboa',
      country: 'Portugal', lat: '38.700000', lng: '-9.400000', captured_at: '2026-09-04 00:59:30.5',
    }]);
    const [e] = await listActiveEntries('sunset');
    expect(e).toMatchObject({ snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.91, detection: 0.88,
      isNew: true, tally: 2, feed: 'sunset', lat: 38.7, lng: -9.4, imageUrl: 'https://storage.googleapis.com/x.jpg' });
    expect(e.enteredAt).toBe(Date.parse('2026-09-04T01:00:00Z'));
    // captured_at is naive UTC text: parsed as UTC whatever the host's zone.
    expect(e.capturedAt).toBe(Date.UTC(2026, 8, 4, 0, 59, 30, 500));
    expect(e.timezone).toBe('Europe/Lisbon');
    expect(e.sunAltitudeDeg).toBeLessThan(0); // 01:59 in Lisbon is night
    expect(lastQuery()).toMatch(/captured_at::text/);
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
  it('commitAdvance bumps the tally after a successful state write, then logs the draw', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const tally = (sqlMock.mock.calls[1][0] as TemplateStringsArray).join('?');
    expect(tally).toMatch(/tally = tally \+ 1/);
    expect(tally).toMatch(/is_new = false/);
    expect(lastQuery()).toMatch(/insert into kiosk_draws/);
    expect(lastQuery()).toMatch(/on conflict \(feed, slot\) do nothing/);
    // The stamp (replay spec §2): version, the newest deploy, the entry as the engine saw it, the frames played.
    expect(lastQuery()).toMatch(/\(select max\(id\) from kiosk_deploys\)/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', 42, 7, 'solo', 'sunset', 0.9, 0.8, [7]]);
  });
  it('a failed draw log does not fail the advance', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('relation "kiosk_draws" does not exist'));
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(3);
    // slot first: the shown-update now stamps last_shown_slot with the SAME
    // counter logDraw writes to kiosk_draws.slot (spec §6.1.1).
    expect(sqlMock.mock.calls[1].slice(1)).toEqual([42, 'sunset', [7]]);
  });
  it('the shown-update and the draw log carry the SAME slot (spec §6.1.1)', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const e = (id: number) => ({ snapshotId: id, webcamId: 3, bin: 'sunset' as const, quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 });
    await commitAdvance('sunset', 77, e(9), 1, [e(7), e(9)], 'solo2');
    const binSlot = sqlMock.mock.calls[1].slice(1)[0];
    const drawSlot = sqlMock.mock.calls.at(-1)!.slice(1)[1];
    // Two counters that happen to agree is the failure that would not
    // announce itself, so this asserts one value reached both writes.
    expect(binSlot).toBe(77);
    expect(drawSlot).toBe(77);
  });
  it('commitAdvance marks every frame of the run shown in one statement', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const e = (id: number) => ({ snapshotId: id, webcamId: 3, bin: 'sunset' as const, quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 });
    await commitAdvance('sunset', 42, e(9), 1, [e(7), e(8), e(9)], 'solo2');
    expect(sqlMock.mock.calls[1].slice(1)).toEqual([42, 'sunset', [7, 8, 9]]);
    // The draw log names the drawn frame and stamps every frame the dwell played.
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', 42, 9, 'solo2', 'sunset', 0.9, 0.8, [7, 8, 9]]);
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

describe('draw log (the tape)', () => {
  it('listRecentDraws returns the last n draws oldest first as whole entries, with numbers not strings', async () => {
    // The query fetches newest first and the function reverses it.
    const row = (slot: string, id: string, shown: string) => ({
      slot, shown_at: shown, snapshot_id: id, webcam_id: '3', bin: 'sunset', quality: '0.8', detection: '0.9', is_new: false,
      tally: '2', entered_at: '2026-09-06T00:00:00Z', captured_at: '2026-09-06 00:30:00', first_shown_at: null, last_shown_at: shown,
      firebase_url: `u${id}`, title: 'B', city: 'Nuuk', region: '', country: 'Greenland', lat: '64.17', lng: '-51.73',
    });
    sqlMock.mockResolvedValueOnce([row('101', '8', '2026-09-06T01:00:20Z'), row('100', '7', '2026-09-06T01:00:00Z')]);
    const out = await listRecentDraws('sunset', 24);
    expect(lastQuery()).toMatch(/from kiosk_draws d/);
    expect(lastQuery()).toMatch(/join kiosk_bin_entries e/);
    expect(lastQuery()).toMatch(/order by d.slot desc/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', 24]);
    expect(out.map((f) => f.snapshotId)).toEqual([7, 8]);
    expect(out[1]).toMatchObject({ slot: 101, snapshotId: 8, shownAt: Date.parse('2026-09-06T01:00:20Z'), feed: 'sunset',
      imageUrl: 'u8', title: 'B', city: 'Nuuk', country: 'Greenland', bin: 'sunset', quality: 0.8, detection: 0.9, tally: 2, webcamId: 3 });
    expect(out[0].capturedAt).toBe(Date.parse('2026-09-06T00:30:00Z'));
  });
  it('listRecentDraws is empty when the table is missing', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_draws" does not exist'));
    expect(await listRecentDraws('sunrise', 24)).toEqual([]);
  });
  it('pruneDraws deletes by age and swallows its own failure', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await pruneDraws(7);
    expect(lastQuery()).toMatch(/delete from kiosk_draws/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual([7]);
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    await expect(pruneDraws(7)).resolves.toBeUndefined();
  });
  it('logDraw swallows its own failure', async () => {
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    const e = { snapshotId: 2, webcamId: 3, bin: 'sunset' as const, quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 };
    await expect(logDraw('sunset', 1, e, 'solo', [e])).resolves.toBeUndefined();
  });
});

describe('replay reads (replay spec §3)', () => {
  const row = (slot: string, id: string, shown: string, stamp: Record<string, unknown> = {}) => ({
    slot, shown_at: shown, snapshot_id: id, webcam_id: '3', bin: 'sunset', quality: '0.8', detection: '0.9', is_new: false,
    tally: '2', entered_at: '2026-09-06T00:00:00Z', captured_at: '2026-09-06 00:30:00', first_shown_at: null, last_shown_at: shown,
    firebase_url: `u${id}`, title: 'B', city: 'Nuuk', region: '', country: 'Greenland', lat: '64.17', lng: '-51.73',
    version: null, deploy_id: null, shown_snapshot_ids: null, ...stamp,
  });
  it('listDrawsBetween returns the window oldest first with the stamp, numbers not strings', async () => {
    sqlMock.mockResolvedValueOnce([
      row('100', '7', '2026-09-06T01:00:00Z'),
      row('101', '8', '2026-09-06T01:00:20Z', { version: 'solo2', deploy_id: '4', shown_snapshot_ids: ['6', '8'] }),
    ]);
    const from = Date.parse('2026-09-06T00:00:00Z');
    const to = Date.parse('2026-09-06T02:00:00Z');
    const out = await listDrawsBetween('sunset', from, to);
    expect(lastQuery()).toMatch(/from kiosk_draws d/);
    expect(lastQuery()).toMatch(/left join kiosk_bin_entries e/);
    expect(lastQuery()).toMatch(/coalesce\(d.bin, e.bin\)/);
    expect(lastQuery()).toMatch(/order by d.slot asc/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', new Date(from).toISOString(), new Date(to).toISOString()]);
    expect(out.map((f) => f.snapshotId)).toEqual([7, 8]);
    // An unstamped row: the frames played default to the drawn frame alone.
    expect(out[0]).toMatchObject({ slot: 100, version: null, deployId: null, shownSnapshotIds: [7], bin: 'sunset', quality: 0.8 });
    expect(out[1]).toMatchObject({ slot: 101, version: 'solo2', deployId: 4, shownSnapshotIds: [6, 8], shownAt: Date.parse('2026-09-06T01:00:20Z') });
  });
  it('listDrawsBetween is empty when the table is missing', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_draws" does not exist'));
    expect(await listDrawsBetween('sunset', 0, 1)).toEqual([]);
  });
  it('listEntriesOverlapping bounds both ends and carries removedAt', async () => {
    sqlMock.mockResolvedValueOnce([
      { ...row('0', '7', '2026-09-06T01:00:00Z'), removed_at: null },
      { ...row('0', '8', '2026-09-06T01:00:20Z'), removed_at: '2026-09-06T01:30:00Z' },
    ]);
    const from = Date.parse('2026-09-06T00:00:00Z');
    const to = Date.parse('2026-09-06T02:00:00Z');
    const out = await listEntriesOverlapping('sunset', from, to);
    expect(lastQuery()).toMatch(/e.entered_at <= /);
    expect(lastQuery()).toMatch(/e.removed_at is null or e.removed_at >= /);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', new Date(to).toISOString(), new Date(from).toISOString()]);
    expect(out[0]).toMatchObject({ snapshotId: 7, removedAt: null, quality: 0.8, webcamId: 3 });
    expect(out[1].removedAt).toBe(Date.parse('2026-09-06T01:30:00Z'));
  });
});
