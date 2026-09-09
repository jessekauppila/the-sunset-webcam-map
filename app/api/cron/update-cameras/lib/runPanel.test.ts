import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { loadRunPanel } from './runPanel';

describe('loadRunPanel', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('returns the panel ids when the flag is on', async () => {
    sqlMock
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ webcam_id: 700 }, { webcam_id: 800 }]);

    const panel = await loadRunPanel();

    expect(panel.has(700)).toBe(true);
    expect(panel.has(800)).toBe(true);
    expect(panel.size).toBe(2);
  });

  it('returns an empty set and never queries the panel when the flag is off', async () => {
    sqlMock.mockResolvedValueOnce([{ enabled: false }]);

    const panel = await loadRunPanel();

    expect(panel.size).toBe(0);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty set when the flag row does not exist', async () => {
    sqlMock.mockResolvedValueOnce([]);

    const panel = await loadRunPanel();

    expect(panel.size).toBe(0);
  });

  it('coerces ids that the driver serializes as strings', async () => {
    sqlMock
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ webcam_id: '700' }]);

    const panel = await loadRunPanel();

    expect(panel.has(700)).toBe(true);
  });
});
