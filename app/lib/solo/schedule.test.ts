import { describe, it, expect } from 'vitest';
import { slotFor, boundaryMs, nextBoundaryMs } from './schedule';

describe('schedule (spec §6.2)', () => {
  it('sunrise slots are multiples of dwell on Unix time', () => {
    expect(slotFor(0, 'sunrise', 20, 10)).toBe(0);
    expect(slotFor(19_999, 'sunrise', 20, 10)).toBe(0);
    expect(slotFor(20_000, 'sunrise', 20, 10)).toBe(1);
  });
  it('sunset slots are shifted by the offset', () => {
    expect(slotFor(9_999, 'sunset', 20, 10)).toBe(-1);
    expect(slotFor(10_000, 'sunset', 20, 10)).toBe(0);
    expect(slotFor(30_000, 'sunset', 20, 10)).toBe(1);
  });
  it('boundaryMs inverts slotFor', () => {
    expect(boundaryMs(3, 'sunrise', 20, 10)).toBe(60_000);
    expect(boundaryMs(3, 'sunset', 20, 10)).toBe(70_000);
  });
  it('the two screens never change at the same instant when offset is nonzero', () => {
    for (let t = 0; t < 200_000; t += 1_000) {
      const rise = boundaryMs(slotFor(t, 'sunrise', 20, 10), 'sunrise', 20, 10);
      const set = boundaryMs(slotFor(t, 'sunset', 20, 10), 'sunset', 20, 10);
      expect(rise).not.toBe(set);
    }
  });
  it('nextBoundaryMs is the first boundary strictly after now', () => {
    expect(nextBoundaryMs(20_000, 'sunrise', 20, 10)).toBe(40_000);
    expect(nextBoundaryMs(20_001, 'sunrise', 20, 10)).toBe(40_000);
    expect(nextBoundaryMs(25_000, 'sunset', 20, 10)).toBe(30_000);
  });
});
