import { isFlagEnabled } from '@/app/lib/runtimeFlags';
import { faaSource } from './faa';
import { digitrafficSource } from './digitraffic';
import { emptyListResult, type Source, type SourceListOptions, type SourceListResult } from './types';

/**
 * Every source the cron knows about, in the order the register ranks them.
 * Adding a source is one adapter file and one line here; turning it on is a
 * runtime flag, so nothing here needs a deploy to come back down.
 */
export const SOURCES: readonly Source[] = [faaSource, digitrafficSource];

export interface SourceTick extends SourceListResult {
  name: string;
  enabled: boolean;
  error?: string;
}

/**
 * One tick's read of every enabled source. Never throws: a source that fails
 * contributes nothing this tick and is reported as such. isFlagEnabled fails
 * closed, so an unreachable database reads every source as off — which is
 * today's behaviour, never extra cost.
 */
export async function fetchEnabledSources(
  opts: SourceListOptions,
  deps: { sources?: readonly Source[]; isEnabled?: (flag: string) => Promise<boolean> } = {},
): Promise<SourceTick[]> {
  const sources = deps.sources ?? SOURCES;
  const isEnabled = deps.isEnabled ?? isFlagEnabled;
  const out: SourceTick[] = [];
  for (const source of sources) {
    const enabled = await isEnabled(source.flag);
    if (!enabled) {
      out.push({ name: source.name, enabled: false, ...emptyListResult() });
      continue;
    }
    try {
      out.push({ name: source.name, enabled: true, ...(await source.listCameras(opts)) });
    } catch (error) {
      out.push({
        name: source.name,
        enabled: true,
        ...emptyListResult(),
        attempted: 1,
        failed: 1,
        failedByStatus: { error: 1 },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
