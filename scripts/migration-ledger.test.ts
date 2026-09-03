import { describe, it, expect } from 'vitest';
import {
  statementsOf,
  ledgerNameOf,
  statusOf,
  formatStatus,
} from './migration-ledger.mjs';

describe('statementsOf', () => {
  it('drops comment lines and splits on semicolons', () => {
    const sql = `-- header\nALTER TABLE t ADD COLUMN IF NOT EXISTS a INT;\n\n-- second\nCREATE INDEX IF NOT EXISTS i ON t (a);\n`;
    expect(statementsOf(sql)).toEqual([
      'ALTER TABLE t ADD COLUMN IF NOT EXISTS a INT',
      'CREATE INDEX IF NOT EXISTS i ON t (a)',
    ]);
  });

  it('returns nothing for a comment-only file', () => {
    expect(statementsOf('-- nothing here\n-- at all\n')).toEqual([]);
  });
});

describe('ledgerNameOf', () => {
  it('keys the ledger by basename regardless of how the path was given', () => {
    expect(ledgerNameOf('database/migrations/20260904_sweep_hold.sql')).toBe('20260904_sweep_hold.sql');
    expect(ledgerNameOf('/tmp/x/20260904_sweep_hold.sql')).toBe('20260904_sweep_hold.sql');
    expect(ledgerNameOf('20260904_sweep_hold.sql')).toBe('20260904_sweep_hold.sql');
  });
});

describe('statusOf', () => {
  const files = [
    'database/migrations/20260902_runtime_flags.sql',
    'database/migrations/20260904_sweep_hold.sql',
    'database/migrations/20260903_sweep_failed_boxes.sql',
  ];

  it('marks recorded files applied and the rest pending, sorted by name', () => {
    const applied = new Map([
      ['20260902_runtime_flags.sql', { applied_at: '2026-09-02T18:00:00Z', note: null }],
      ['20260903_sweep_failed_boxes.sql', { applied_at: '2026-09-03T04:00:00Z', note: 'backfilled' }],
    ]);
    const s = statusOf(files, applied);
    expect(s.rows.map((r) => [r.name, r.state])).toEqual([
      ['20260902_runtime_flags.sql', 'applied'],
      ['20260903_sweep_failed_boxes.sql', 'applied'],
      ['20260904_sweep_hold.sql', 'pending'],
    ]);
    expect(s.pending).toEqual(['20260904_sweep_hold.sql']);
    expect(s.orphans).toEqual([]);
  });

  it('reports ledger rows whose file is gone as orphans, never dropping them', () => {
    const applied = new Map([
      ['20260101_renamed_away.sql', { applied_at: '2026-01-01T00:00:00Z', note: null }],
    ]);
    const s = statusOf(files, applied);
    expect(s.orphans).toEqual(['20260101_renamed_away.sql']);
    expect(s.pending).toHaveLength(3);
  });

  it('is clean when every file is recorded', () => {
    const applied = new Map(files.map((f) => [ledgerNameOf(f), { applied_at: 'x', note: null }]));
    const s = statusOf(files, applied);
    expect(s.pending).toEqual([]);
    expect(formatStatus(s)).toContain('All 3 migrations recorded as applied.');
  });

  it('says PENDING loudly and counts them in the summary line', () => {
    const s = statusOf(files, new Map());
    const text = formatStatus(s);
    expect(text).toContain('PENDING  20260904_sweep_hold.sql');
    expect(text).toContain('3 PENDING of 3');
  });
});
