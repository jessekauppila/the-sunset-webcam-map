// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/lib/runtimeFlags', () => ({
  SOURCE_FAA: 'source_faa',
  SOURCE_DIGITRAFFIC: 'source_digitraffic',
  isFlagEnabled: vi.fn(async () => false),
}));

import { fetchEnabledSources, SOURCES } from './registry';
import type { Source, SourceListOptions } from './types';

const opts: SourceListOptions = { now: new Date('2026-09-15T02:50:00Z'), within: () => true };

function fakeSource(name: string, list: Source['listCameras']): Source {
  return { name, flag: `source_${name}`, listCameras: list };
}

describe('fetchEnabledSources', () => {
  it('lists the sources in the register\'s order: FAA, then Digitraffic', () => {
    expect(SOURCES.map((s) => s.name)).toEqual(['faa', 'digitraffic']);
  });

  it('does not call a source whose flag is off, and reports it disabled', async () => {
    const list = vi.fn();
    const ticks = await fetchEnabledSources(opts, {
      sources: [fakeSource('a', list)],
      isEnabled: async () => false,
    });
    expect(list).not.toHaveBeenCalled();
    expect(ticks).toEqual([
      { name: 'a', enabled: false, cameras: [], attempted: 0, failed: 0, failedByStatus: {}, skipped: {}, elapsedMs: 0 },
    ]);
  });

  it('calls an enabled source with the tick options and returns its result', async () => {
    const list = vi.fn(async () => ({
      cameras: [], attempted: 1, failed: 0, failedByStatus: {}, skipped: { stale: 2 }, elapsedMs: 5,
    }));
    const ticks = await fetchEnabledSources(opts, {
      sources: [fakeSource('a', list)],
      isEnabled: async (flag) => flag === 'source_a',
    });
    expect(list).toHaveBeenCalledWith(opts);
    expect(ticks[0]).toMatchObject({ name: 'a', enabled: true, skipped: { stale: 2 } });
  });

  it('turns a throwing source into a failed tick instead of failing the cron', async () => {
    const ticks = await fetchEnabledSources(opts, {
      sources: [
        fakeSource('bad', async () => { throw new Error('boom'); }),
        fakeSource('good', async () => ({ cameras: [], attempted: 1, failed: 0, failedByStatus: {}, skipped: {}, elapsedMs: 1 })),
      ],
      isEnabled: async () => true,
    });
    expect(ticks[0]).toMatchObject({ name: 'bad', enabled: true, failed: 1, failedByStatus: { error: 1 }, error: 'boom' });
    expect(ticks[1]).toMatchObject({ name: 'good', failed: 0 });
  });
});
