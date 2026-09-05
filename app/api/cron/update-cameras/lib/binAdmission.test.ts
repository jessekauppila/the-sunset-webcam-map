// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertEntry = vi.fn();
const activeWebcamIds = vi.fn();
const getCalibrationMultipliers = vi.fn();
const listActiveEntries = vi.fn();
const markSeen = vi.fn();
const markOutOfZone = vi.fn();
const removeStale = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/solo/store', () => ({
  insertEntry: (...a: unknown[]) => insertEntry(...a),
  activeWebcamIds: (...a: unknown[]) => activeWebcamIds(...a),
  getCalibrationMultipliers: (...a: unknown[]) => getCalibrationMultipliers(...a),
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  markSeen: (...a: unknown[]) => markSeen(...a),
  markOutOfZone: (...a: unknown[]) => markOutOfZone(...a),
  removeStale: (...a: unknown[]) => removeStale(...a),
}));

import { decideBin, enterBins, maintainBins, BIN_ADMIT_DETECTION_FLOOR } from './binAdmission';

beforeEach(() => {
  vi.clearAllMocks();
  activeWebcamIds.mockResolvedValue(new Set());
  getCalibrationMultipliers.mockResolvedValue(new Map());
  insertEntry.mockResolvedValue(true);
  removeStale.mockResolvedValue({ leftZone: 0, expired: 0 });
});

describe('decideBin (fixed cron floors, spec §5.3)', () => {
  it('detection verdict first: a sunset enters the sunset bin whatever its probability looks like', () => {
    expect(decideBin({ binaryIsSunset: true, binaryRawScore: 0.56 })).toBe('sunset');
  });
  it('a non-sunset at or above the floor enters the non-sunset bin', () => {
    expect(decideBin({ binaryIsSunset: false, binaryRawScore: BIN_ADMIT_DETECTION_FLOOR })).toBe('non_sunset');
  });
  it('below the floor, or with no binary verdict, nothing', () => {
    expect(decideBin({ binaryIsSunset: false, binaryRawScore: 0.19 })).toBeNull();
    expect(decideBin({})).toBeNull();
  });
});

describe('enterBins', () => {
  it('applies the calibration multiplier to sunset quality and leaves detection raw', async () => {
    getCalibrationMultipliers.mockResolvedValue(new Map([[3, 0.5]]));
    await enterBins([{ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, rawQuality: 0.8, detection: 0.9 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.4, detection: 0.9, isNew: false }));
  });
  it('non-sunset rows carry null quality', async () => {
    await enterBins([{ feed: 'sunset', bin: 'non_sunset', snapshotId: 8, webcamId: 4, rawQuality: 0.8, detection: 0.3 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ quality: null }));
  });
  it('flags isNew when the camera already has an active entry in that feed', async () => {
    activeWebcamIds.mockResolvedValue(new Set([3]));
    await enterBins([{ feed: 'sunrise', bin: 'sunset', snapshotId: 9, webcamId: 3, rawQuality: 0.8, detection: 0.9 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ isNew: true }));
  });
  it('counts per bin and counts conflicts as duplicates', async () => {
    insertEntry.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const out = await enterBins([
      { feed: 'sunset', bin: 'sunset', snapshotId: 1, webcamId: 1, rawQuality: 0.9, detection: 0.9 },
      { feed: 'sunset', bin: 'non_sunset', snapshotId: 2, webcamId: 2, rawQuality: 0.2, detection: 0.4 },
    ]);
    expect(out).toEqual({ sunset: 1, nonSunset: 0, duplicates: 1 });
  });
});

describe('maintainBins', () => {
  const zone = { minDeg: -24, maxDeg: -2 };
  // Seattle at ~50 min after sunset on 2026-09-04: in the sunset zone.
  const seattleDusk = new Date('2026-09-05T03:30:00Z');
  const entry = (feed: string, webcamId: number, lat: number, lng: number) => ({
    feed, webcamId, lat, lng, snapshotId: webcamId, bin: 'sunset', quality: 0.9, detection: 0.9,
    isNew: false, tally: 0, enteredAt: 0, imageUrl: '', title: '', city: '', region: '', country: '',
    firstShownAt: null, lastShownAt: null,
  });
  it('marks in-zone cameras seen and out-of-zone cameras out, per feed, then removes stale', async () => {
    listActiveEntries.mockImplementation(async (feed: string) =>
      feed === 'sunset'
        ? [entry('sunset', 1, 47.6062, -122.3321), entry('sunset', 2, 0, 0)] // Seattle dusk; Gulf of Guinea deep night
        : []);
    const out = await maintainBins({ now: seattleDusk, zone, grace: 2 });
    expect(markSeen).toHaveBeenCalledWith('sunset', [1]);
    expect(markOutOfZone).toHaveBeenCalledWith('sunset', [2]);
    expect(removeStale).toHaveBeenCalledWith('sunset', { grace: 2, maxAgeHours: 24 });
    expect(removeStale).toHaveBeenCalledWith('sunrise', { grace: 2, maxAgeHours: 24 });
    expect(out).toEqual({ leftZone: 0, expired: 0 });
  });
  it('absence from a poll is not a reason: only zone membership drives the counters', async () => {
    listActiveEntries.mockImplementation(async (feed: string) =>
      feed === 'sunset' ? [entry('sunset', 1, 47.6062, -122.3321)] : []);
    await maintainBins({ now: seattleDusk, zone, grace: 2 });
    expect(markOutOfZone).toHaveBeenCalledWith('sunset', []);
  });
});
