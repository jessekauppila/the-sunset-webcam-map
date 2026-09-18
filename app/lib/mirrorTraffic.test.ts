import { describe, it, expect, vi, beforeEach } from 'vitest';

const incrMirrorCallBucket = vi.fn();
const getMirrorCallBuckets = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  incrMirrorCallBucket: (key: string) => incrMirrorCallBucket(key),
  getMirrorCallBuckets: (keys: string[]) => getMirrorCallBuckets(keys),
}));

import { countMirrorCall, getMirrorTraffic, mirrorBucketKey } from './mirrorTraffic';
import { MIRROR_CALLS_PER_VIEWER_HOUR, MIRROR_COUNT_SAMPLE_RATE } from './masterConfig';

// Braces, not a concise arrow: mockReset() returns the mock, and a returned
// function from a hook is treated as teardown.
beforeEach(() => {
  incrMirrorCallBucket.mockReset();
  getMirrorCallBuckets.mockReset();
});

const AT = new Date('2026-09-17T19:42:10Z');
const SCALE = 1 / MIRROR_COUNT_SAMPLE_RATE;

describe('mirrorBucketKey', () => {
  it('buckets by feed and UTC hour', () => {
    expect(mirrorBucketKey('sunset', AT)).toBe('mirror:calls:sunset:2026-09-17T19');
    expect(mirrorBucketKey('sunrise', new Date('2026-01-02T03:59:59Z'))).toBe('mirror:calls:sunrise:2026-01-02T03');
  });
});

describe('countMirrorCall', () => {
  it('counts a sampled call into its hour', async () => {
    await countMirrorCall('sunset', AT, () => 0);

    expect(incrMirrorCallBucket).toHaveBeenCalledWith('mirror:calls:sunset:2026-09-17T19');
  });

  it('skips a call outside the sample, so the counter costs a tenth of the reads', async () => {
    await countMirrorCall('sunset', AT, () => MIRROR_COUNT_SAMPLE_RATE);

    expect(incrMirrorCallBucket).not.toHaveBeenCalled();
  });

  it('never throws: a failed count must not reach the route that called it', async () => {
    incrMirrorCallBucket.mockRejectedValue(new Error('upstash down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(countMirrorCall('sunset', AT, () => 0)).resolves.toBeUndefined();

    warn.mockRestore();
  });
});

describe('getMirrorTraffic', () => {
  /** 24 hourly counts per feed, oldest first, as the sampled raw values Redis holds. */
  function stored(sunset: (number | null)[], sunrise: (number | null)[]) {
    getMirrorCallBuckets.mockImplementation(async (keys: string[]) =>
      keys.map((k) => {
        const i = keys.indexOf(k);
        return k.includes(':sunset:') ? sunset[i % 24] : sunrise[i % 24];
      }),
    );
  }

  it('reads the 24 hours ending in the current one, for both feeds', async () => {
    stored(Array(24).fill(null), Array(24).fill(null));

    await getMirrorTraffic(AT);

    const keys = getMirrorCallBuckets.mock.calls[0][0] as string[];
    expect(keys).toHaveLength(48);
    expect(keys).toContain('mirror:calls:sunset:2026-09-16T20');
    expect(keys).toContain('mirror:calls:sunset:2026-09-17T19');
    expect(keys).not.toContain('mirror:calls:sunset:2026-09-16T19');
  });

  it('scales sampled counts back up and finds the peak hour', async () => {
    const sunset = Array(24).fill(36);
    sunset[23] = 72; // 19:00 UTC, the current hour, is the busiest
    stored(sunset, Array(24).fill(null));

    const t = await getMirrorTraffic(AT);

    expect(t?.sunset.calls).toBe((36 * 23 + 72) * SCALE);
    expect(t?.sunset.peakHourCalls).toBe(72 * SCALE);
    expect(t?.sunset.peakHourUtc).toBe('19:00');
    expect(t?.sunset.viewersAtPeak).toBe(Math.round((72 * SCALE) / MIRROR_CALLS_PER_VIEWER_HOUR));
  });

  it('reports a quiet feed as zero, not as missing', async () => {
    stored(Array(24).fill(null), Array(24).fill(null));

    const t = await getMirrorTraffic(AT);

    expect(t?.sunrise).toEqual({ calls: 0, peakHourCalls: 0, peakHourUtc: null, viewersAtPeak: 0 });
  });

  it('returns null when the counts cannot be read, so the digest drops the line', async () => {
    getMirrorCallBuckets.mockResolvedValue(null);

    expect(await getMirrorTraffic(AT)).toBeNull();
  });
});
