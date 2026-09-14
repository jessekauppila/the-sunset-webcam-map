import { describe, it, expect } from 'vitest';
import { runKey } from './runKey';

describe('runKey', () => {
  it('groups an evening that straddles UTC midnight into one run', () => {
    // Seattle, lng -122. Both frames are the same local evening, but they sit
    // on opposite sides of UTC midnight, so a naive UTC date splits them.
    const before = new Date('2026-09-07T23:30:00Z');
    const after = new Date('2026-09-08T01:00:00Z');

    expect(runKey(700, 'sunset', before, -122)).toBe('700:sunset:2026-09-07');
    expect(runKey(700, 'sunset', after, -122)).toBe('700:sunset:2026-09-07');
  });

  it('separates two different evenings on the same camera', () => {
    const monday = new Date('2026-09-08T02:00:00Z');
    const tuesday = new Date('2026-09-09T02:00:00Z');

    expect(runKey(700, 'sunset', monday, -122)).not.toBe(
      runKey(700, 'sunset', tuesday, -122),
    );
  });

  it('keeps sunrise and sunset on the same camera and day apart', () => {
    const at = new Date('2026-09-08T02:00:00Z');

    expect(runKey(700, 'sunset', at, -122)).not.toBe(
      runKey(700, 'sunrise', at, -122),
    );
  });

  it('handles an eastern longitude', () => {
    // Tokyo, lng +139. 2026-09-08T09:30Z is the evening of 09-08 local.
    const at = new Date('2026-09-08T09:30:00Z');
    expect(runKey(42, 'sunset', at, 139)).toBe('42:sunset:2026-09-08');
  });
});
