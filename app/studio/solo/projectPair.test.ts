import { describe, it, expect } from 'vitest';
import { projectPair, ghostFor } from './projectPair';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { dialsFrom2, SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { StateView, ViewEntry, EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { StripFrame, ReplayEntry } from '@/app/lib/solo/replay';

/**
 * projectPair (one-tape spec §4.1): both screens projected from a StateView's
 * live pool and draw log, from the instant its current dwell ends, once with
 * the dials as given and once with the rendezvous off. These fixtures are
 * hand-built StateViews (no fetch, no store) — only the fields projectPair
 * actually reads (`current`, `entries`, `tape`) carry meaningful values; the
 * rest are minimal filler the type requires.
 */

// solo2 defaults: beat 4 s, still (dwellBeats) 3, change 1 beat, sunset cap 8
// (rank-shaped), rendezvous rank 0.6. The spread (dwellBoost/dwellTrim) is
// forced to 0 so every draw's budget is exactly the still, per the brief.
const D2: Solo2Dials = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), rendezvous: true, dwellBoost: 0, dwellTrim: 0 };
const SOLO_D: SoloDials = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const solo2 = SOLO_VERSIONS.solo2;
const solo = SOLO_VERSIONS.solo;

const beat = (n: number) => n * 4_000; // D2.beatS === 4
const T0 = 1_000_000_000_000; // divisible by 4_000, so it sits on the beat grid

/** One frame of a camera's night. A null quality is a non-sunset. */
function frame(id: number, cam: number, capturedAt: number, quality: number | null): ViewEntry {
  return {
    snapshotId: id, webcamId: cam, bin: quality == null ? 'non_sunset' : 'sunset', quality, detection: 0.8,
    isNew: false, tally: 0, enteredAt: capturedAt, lastShownAt: null,
    imageUrl: '', title: `cam${cam}`, city: '', region: '', country: '',
    capturedAt, timezone: null, sunAltitudeDeg: null, credit: null,
  };
}

const DUMMY_ENTRY: EntryView = { ...frame(0, 0, T0, null), eligible: false, rank: 0, stage: { kind: 'onGlass' } };

/** A `current` block; only the fields a case cares about need overriding. */
function cur(overrides: Partial<NonNullable<StateView['current']>> = {}): NonNullable<StateView['current']> {
  return {
    entry: DUMMY_ENTRY, shownSince: null, slot: null, endsAtMs: null,
    shownSnapshotIds: [], peakAtMs: null, rendezvous: false,
    ...overrides,
  };
}

/** A StateView; `dials`/`next`/`bins`/etc. are unread by projectPair and filled with placeholders. */
function view(feed: Feed, entries: ViewEntry[], current: StateView['current']): StateView {
  return {
    feed, dials: D2, current, next: [], nextRoles: [],
    bins: { sunset: [], nonSunset: [] },
    schedule: { slot: 0, nextBoundaryMs: 0 },
    lastPull: { admitted: { sunset: 0, nonSunset: 0 } },
    entries, zone: { minDeg: -90, maxDeg: 90 }, tape: [],
  };
}

describe('projectPair', () => {
  it("starts each strip's first block at that screen's own current.endsAtMs, not at nowMs", () => {
    const nowMs = T0;
    const sunriseEnds = T0 + beat(2);
    const sunsetEnds = T0 + beat(5);
    const sunrise = view('sunrise', [], cur({ endsAtMs: sunriseEnds }));
    const sunset = view('sunset', [], cur({ endsAtMs: sunsetEnds }));

    const out = projectPair({ sunrise, sunset, dials: D2, version: solo2, nowMs, horizonMs: beat(6) });

    expect(sunriseEnds).not.toBe(nowMs);
    expect(sunsetEnds).not.toBe(nowMs);
    expect(out.sunrise[0].shownAt).toBe(sunriseEnds);
    expect(out.sunset[0].shownAt).toBe(sunsetEnds);
  });

  it('fits an eligible sunrise draw to a peak the sunset screen already pinned two beats ahead', () => {
    // sunset: nothing eligible of its own in the window (so nothing overwrites
    // the pin), but its live dwell already pinned a landing two beats past its
    // own fromMs — exactly what the studio reads off `current.peakAtMs`.
    const nowMs = T0;
    const sunset = view('sunset', [], cur({ endsAtMs: T0, peakAtMs: T0 + beat(2) }));
    // sunrise: one camera, a one-frame climb then its peak — avail =
    // beat(2)/beat(1) − 1 change beat = 1, and the climb is exactly 1 deep,
    // so it fits without dropping anything.
    const sunriseNight = [frame(1, 9, 100, 0.3), frame(2, 9, 200, 0.9)];
    const sunrise = view('sunrise', sunriseNight, cur({ endsAtMs: T0 }));

    const out = projectPair({ sunrise, sunset, dials: D2, version: solo2, nowMs, horizonMs: beat(3) });

    expect(out.landings).toEqual([{ atMs: T0 + beat(2), sunriseSlot: 0, sunsetSlot: 0 }]);
    expect(out.sunrise[0]).toMatchObject({ snapshotId: 2, rendezvous: true, peakAtMs: T0 + beat(2) });
  });

  describe('ghosts: where a block would have landed with the rendezvous off', () => {
    it("equals fromMs + (changeBeats + fullClimbIndex) x beatS x 1000 for a block the rendezvous fitted", () => {
      // Same fixture as replay.test.ts's "sunset pins, sunrise fits" case,
      // wrapped in StateViews. sunset (camera 7): climb of 4, peak at index 4
      // (quality 0.9), one frame after — a lone sunset ranks 1, so the cap is
      // 8 and the whole night plays; it pins T0 + (1 change + 4) beats = T0 + beat(5).
      const nowMs = T0;
      const sunsetNight = [
        frame(1, 7, 100, 0.3), frame(2, 7, 200, 0.4), frame(3, 7, 300, 0.5),
        frame(4, 7, 400, 0.6), frame(5, 7, 500, 0.9), frame(6, 7, 600, 0.5),
      ];
      const sunset = view('sunset', sunsetNight, cur({ endsAtMs: T0 }));
      // sunrise (camera 17), fromMs = T0 + beat(1): climb of 5, peak at index
      // 5 (quality 0.95), one frame after. avail = (5−1) beats − 1 change = 3,
      // and the climb is 5 deep, so thinClimb(5, 3) keeps frames 1/3/5 of the
      // climb (ids 11, 13, 15) and drops 12 and 14 — it fits, landing at
      // T0 + beat(1) + (1 change + 3) beats = T0 + beat(5), same tick as the pin.
      const sunriseNight = [
        frame(11, 17, 100, 0.2), frame(12, 17, 200, 0.3), frame(13, 17, 300, 0.4), frame(14, 17, 400, 0.5),
        frame(15, 17, 500, 0.6), frame(16, 17, 600, 0.95), frame(17, 17, 700, 0.7),
      ];
      const sunrise = view('sunrise', sunriseNight, cur({ endsAtMs: T0 + beat(1) }));

      const out = projectPair({ sunrise, sunset, dials: D2, version: solo2, nowMs, horizonMs: beat(1) });

      // The draw itself names the camera's newest frame (17); the peak (16)
      // is the frame the landing is measured against, not the draw's own id.
      expect(out.sunrise[0]).toMatchObject({ snapshotId: 17, rendezvous: true, peakAtMs: T0 + beat(5), dropped: 2 });
      // Without the rendezvous, this block's climb is not thinned: the full
      // 5-frame climb plays, so the peak (camera 17's frame 16) sits at index
      // 5 of the unfitted run — fromMs (T0 + beat(1)) + (1 change + 5) beats
      // = T0 + beat(1) + beat(6) = T0 + beat(7), later than where it actually
      // landed (T0 + beat(5)) because the fit thinned the climb to reach it sooner.
      expect(out.ghosts.sunrise[0]).toBe(T0 + beat(1) + beat(6));
      expect(out.ghosts.sunrise[0]).not.toBe(out.sunrise[0].peakAtMs);
    });

    it('is null for a block whose camera has no sunset frame to peak on', () => {
      const nowMs = T0;
      // A single non-sunset frame: its camera's group has no sunset among it,
      // so peakOf finds nothing and the block draws plainly.
      const sunriseNight = [frame(21, 40, 100, null)];
      const sunrise = view('sunrise', sunriseNight, cur({ endsAtMs: T0 }));
      const sunset = view('sunset', [], cur({ endsAtMs: T0 }));

      const out = projectPair({ sunrise, sunset, dials: D2, version: solo2, nowMs, horizonMs: beat(1) });

      expect(out.sunrise[0].webcamId).toBe(40);
      expect(out.ghosts.sunrise[0]).toBeNull();
    });
  });

  it('with the solo version, both strips still exist, landings is empty and every ghost is null', () => {
    const nowMs = T0;
    const sunriseNight = [frame(31, 50, 100, 0.5)];
    const sunsetNight = [frame(41, 60, 100, 0.6)];
    const sunrise = view('sunrise', sunriseNight, cur({ endsAtMs: T0 }));
    const sunset = view('sunset', sunsetNight, cur({ endsAtMs: T0 }));

    const out = projectPair({ sunrise, sunset, dials: SOLO_D, version: solo, nowMs, horizonMs: 30_000 });

    expect(out.sunrise.length).toBeGreaterThan(0);
    expect(out.sunset.length).toBeGreaterThan(0);
    expect(out.landings).toEqual([]);
    expect(out.ghosts.sunrise.every((g) => g === null)).toBe(true);
    expect(out.ghosts.sunset.every((g) => g === null)).toBe(true);
  });
});

/** A ViewEntry, shaped as the replay's own bin rows (item 3's `groups` argument). */
const toReplay = (e: ViewEntry): ReplayEntry => ({ ...e, removedAt: null, firstShownAt: null });

/** A minimal StripFrame; only the fields `ghostFor` reads need real values. */
function stripFrame(overrides: Partial<StripFrame> = {}): StripFrame {
  return {
    slot: 0, shownAt: T0, snapshotId: 1, webcamId: 7, bin: 'sunset', quality: 0.5, detection: 0.8,
    title: '', imageUrl: '', capturedAt: T0, shownSnapshotIds: [1], repeat: false, dwellMs: beat(1),
    peakAtMs: null, rendezvous: false, dropped: 0, grown: 0,
    ...overrides,
  };
}

describe('ghostFor (final-fix item 3)', () => {
  // The with-run and without-run are matched by slot, but a fit can leave
  // the two runs drawing different cameras at the same slot index (the
  // with-run does not stamp its dropped frames shown). A ghost must never
  // describe another camera's landing.
  it('is null when the unfitted frame at this slot names a different camera than the fitted one', () => {
    const groups = new Map([
      [7, [toReplay(frame(1, 7, 100, 0.9))]],
      [9, [toReplay(frame(5, 9, 100, 0.9))]],
    ]);
    const fitted = stripFrame({ webcamId: 7, shownSnapshotIds: [1] });
    const unfitted = stripFrame({ webcamId: 9, shownSnapshotIds: [5] }); // same slot, a different camera
    expect(ghostFor(fitted, unfitted, groups, 1, beat(1))).toBeNull();
  });

  it('is null with no unfitted frame at this slot at all', () => {
    const groups = new Map([[7, [toReplay(frame(1, 7, 100, 0.9))]]]);
    expect(ghostFor(stripFrame({ webcamId: 7 }), undefined, groups, 1, beat(1))).toBeNull();
  });

  it('lands on the unfitted peak when the two runs agree on the camera', () => {
    const groups = new Map([[7, [toReplay(frame(1, 7, 100, 0.3)), toReplay(frame(2, 7, 200, 0.9))]]]);
    const unfitted = stripFrame({ webcamId: 7, shownAt: T0, shownSnapshotIds: [1, 2] }); // peak (id 2) at index 1
    expect(ghostFor(stripFrame({ webcamId: 7 }), unfitted, groups, 1, beat(1))).toBe(T0 + beat(2)); // (change 1 + index 1) beats
  });
});
