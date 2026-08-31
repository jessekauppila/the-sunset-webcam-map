import { describe, it, expect } from 'vitest';
import { liveRole } from './liveModels';
import {
  AI_BINARY_MODEL_VERSION_DEFAULT,
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
} from '@/app/lib/masterConfig';

describe('liveRole', () => {
  it('marks the shipping detection run as live', () => {
    // The deployed version string is `<timestamp>_<run_name>` and the
    // leaderboard slug is the run name, so the pin itself is the source
    // of truth — the badge can never drift from what prod runs.
    const slug = AI_BINARY_MODEL_VERSION_DEFAULT.replace(/^\d{8}_\d{6}_/, '');
    expect(liveRole(slug)).toBe('detection');
  });

  it('marks the shipping quality run as live', () => {
    const slug = AI_REGRESSION_MODEL_VERSION_DEFAULT.replace(/^\d{8}_\d{6}_/, '');
    expect(liveRole(slug)).toBe('quality');
  });

  it('does not badge a run whose name merely extends the shipping name', () => {
    // v5_binary_gold_llm_finetune must not light up when v5_binary_gold ships.
    const slug = AI_BINARY_MODEL_VERSION_DEFAULT.replace(/^\d{8}_\d{6}_/, '');
    expect(liveRole(`${slug}_llm_finetune`)).toBeNull();
    expect(liveRole(`other_${slug}`)).toBeNull();
  });

  it('returns null for retired runs', () => {
    expect(liveRole('v4_regression_llm_with_flickr')).toBeNull();
  });
});
