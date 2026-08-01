import { describe, it, expect } from 'vitest';
import { pct, deriveDailyDeltas } from './opsMath';

describe('pct', () => {
  it('computes a rounded percentage', () => {
    expect(pct(400, 500)).toBe(80);
    expect(pct(1, 3)).toBe(33.3);
  });
  it('returns null for a zero denominator', () => {
    expect(pct(5, 0)).toBeNull();
  });
});

describe('deriveDailyDeltas', () => {
  const P = 'noisy-leaf-96391119';
  it('derives per-day compute hours from month-to-date counters', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-01', project_id: P, compute_time_s: 36000 }, // 10h MTD
      { day: '2026-08-02', project_id: P, compute_time_s: 72000 }, // 20h MTD
    ]);
    expect(out).toEqual([
      { day: '2026-08-02', project_id: P, computeHours: 10 },
    ]);
  });
  it('uses the raw value on month rollover (counter reset)', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-31', project_id: P, compute_time_s: 900000 },
      { day: '2026-09-01', project_id: P, compute_time_s: 18000 }, // reset, 5h
    ]);
    expect(out).toEqual([
      { day: '2026-09-01', project_id: P, computeHours: 5 },
    ]);
  });
  it('keeps projects independent', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-01', project_id: 'a', compute_time_s: 3600 },
      { day: '2026-08-01', project_id: 'b', compute_time_s: 7200 },
      { day: '2026-08-02', project_id: 'a', compute_time_s: 7200 },
      { day: '2026-08-02', project_id: 'b', compute_time_s: 7200 },
    ]);
    expect(out).toEqual([
      { day: '2026-08-02', project_id: 'a', computeHours: 1 },
      { day: '2026-08-02', project_id: 'b', computeHours: 0 },
    ]);
  });
});
