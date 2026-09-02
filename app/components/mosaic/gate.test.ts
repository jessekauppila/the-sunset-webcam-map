import { describe, it, expect } from 'vitest';
import { countGatePasses, resolveGate } from './gate';
import { AI_BINARY_DECISION_THRESHOLD } from '@/app/lib/masterConfig';
import type { WindyWebcam } from '@/app/lib/types';

const base = { webcamId: '1', title: 'cam', lat: 0, lon: 0 } as unknown as WindyWebcam;
const V1_GATE = 1 + AI_BINARY_DECISION_THRESHOLD * 4;

describe('resolveGate', () => {
  it('reads v1 gate-passers from the detection head at v1s frozen threshold', () => {
    const gate = resolveGate('v1');
    expect(gate({ ...base, aiRatingBinary: V1_GATE }, {})).toBe(true);
    expect(gate({ ...base, aiRatingBinary: V1_GATE - 0.01 }, {})).toBe(false);
  });

  it('ignores the v2 dials when v1 is the version on the glass', () => {
    const gate = resolveGate('v1');
    // gateThreshold 0 would pass everything under v2; v1 has no such dial.
    expect(gate({ ...base, aiRatingBinary: 1 }, { gateThreshold: 0 })).toBe(false);
  });

  it('moves with the v2 gateThreshold dial', () => {
    const gate = resolveGate('v2');
    const w = { ...base, aiRatingBinary: 3 };
    // ratingGate = 1 + t * 4, so t=0.4 gates at 2.6 and t=0.6 gates at 3.4.
    expect(gate(w, { qualitySource: 'model', gateThreshold: 0.4 })).toBe(true);
    expect(gate(w, { qualitySource: 'model', gateThreshold: 0.6 })).toBe(false);
  });

  it('counts a Claude-scored frame under v2 auto, where v1 sees nothing', () => {
    const w = { ...base, llmIsSunset: true, llmQuality: 0.9 };
    expect(resolveGate('v2')(w, { qualitySource: 'auto', gateThreshold: 0.55 })).toBe(true);
    expect(resolveGate('v1')(w, {})).toBe(false);
  });

  it('applies the schema defaults when the settings object is empty', () => {
    const gate = resolveGate('v2');
    // Default source is auto and default gateThreshold 0.55 -> rating gate 3.2.
    expect(gate({ ...base, aiRatingBinary: 3.5 }, {})).toBe(true);
    expect(gate({ ...base, aiRatingBinary: 3.0 }, {})).toBe(false);
  });

  it('falls back to the pinned default version for an unknown name', () => {
    expect(resolveGate('v999')({ ...base, aiRatingBinary: V1_GATE }, {})).toBe(true);
  });
});

describe('countGatePasses', () => {
  it('reports passers against the whole pool, not just the scored part', () => {
    const pool = [
      { ...base, aiRatingBinary: 4 },
      { ...base, aiRatingBinary: 1.5 },
      { ...base },
    ];
    expect(countGatePasses(pool, resolveGate('v2'), {})).toEqual({ pass: 1, total: 3 });
  });

  it('is zero over an empty pool rather than undefined', () => {
    expect(countGatePasses([], resolveGate('v2'), {})).toEqual({ pass: 0, total: 0 });
  });
});
