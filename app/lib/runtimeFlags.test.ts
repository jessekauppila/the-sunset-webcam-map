// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from './runtimeFlags';

// Braces, not a concise arrow: mockReset() returns the mock, and Vitest treats
// a value returned from a hook as a teardown callback.
beforeEach(() => {
  sqlMock.mockReset();
});

describe('isFlagEnabled', () => {
  it('is true when the row says enabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: true }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(true);
  });

  it('is false when the row says disabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: false }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('is false when the row does not exist', async () => {
    sqlMock.mockResolvedValue([]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('fails closed when the table is missing or the read throws', async () => {
    // A flag that fails OPEN would spend money on an unreachable database,
    // which is the one failure mode the operator's cost condition rules out.
    // This also covers the deploy window before the migration is applied.
    sqlMock.mockRejectedValue(new Error('relation "runtime_flags" does not exist'));
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('does not treat a truthy non-boolean as enabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: 'false' }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });
});
