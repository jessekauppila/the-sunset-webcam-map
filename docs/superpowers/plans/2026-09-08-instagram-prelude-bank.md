# Instagram Prelude Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hand-run script that writes the twenty best sunrise and twenty best sunset camera runs to disk as Instagram-ready 4:5 cards with captions, sorted by whether each picture's source allows posting.

**Architecture:** Five pure modules under `app/lib/prelude/` do the thinking — clustering frames into series, ranking them into a bank, writing a caption, laying out a card, and deciding from a camera's source whether its pictures may be posted. One script under `scripts/` does the talking to Postgres, the image host and the filesystem. Nothing writes to production and nothing runs on a cron.

**Tech Stack:** TypeScript, vitest, `sharp` for compositing, `suncalc` via `app/lib/solarPhase.ts`, `@neondatabase/serverless` for the read, `vite-node` to run the script.

**Spec:** `docs/superpowers/specs/2026-09-08-instagram-prelude-bank-design.md`

## Global Constraints

- **Read `captured_at` as `captured_at AT TIME ZONE 'UTC'`.** The column is `timestamp WITHOUT time zone` holding UTC digits and the Neon driver shifts it by the server's local offset. Getting this wrong moves every sun altitude by hours. Spec §4.1.
- **Rank on `ai_regression_score` only.** `llm_quality` is null on every frame in the window. Spec §2.
- **Phase comes from `solarPhaseAt` in `app/lib/solarPhase.ts`**, never from the `phase` column and never from `llm_is_sunrise`. Spec §3.2.
- **Constants, verbatim from the spec:** series gap 45 minutes; minimum 6 frames; minimum binary score 0.5; maximum 10 frames per series; bank limit 20 per phase; one series per camera; card 1080 by 1350; a frame drawn at no more than its source's `maxScale` (Windy 1, our own camera 2).
- **Never upscale a frame to full bleed.** Spec §6.
- **No model score in the caption.** Spec §7.
- **Whether a picture may be posted comes from its camera's `webcams.source`, and nothing else.** An unknown or missing source is `no_post`. Only `ready/` holds postable output; every card in `practice/` carries the stamp. Spec §3a.
- Tests are vitest, colocated as `<name>.test.ts` beside the module, matching the house style in `app/lib/solo/zone.test.ts`.

---

### Task 1: Clustering frames into series

**Files:**
- Create: `app/lib/prelude/types.ts`
- Create: `app/lib/prelude/series.ts`
- Test: `app/lib/prelude/series.test.ts`

**Interfaces:**
- Consumes: `solarPhaseAt`, `SolarPhase` from `app/lib/solarPhase.ts`.
- Produces: `PreludeFrame`, `PreludeCamera`, `PreludeSeries` (types); `SERIES_GAP_MS`, `MIN_FRAMES`, `MIN_BINARY`, `MAX_FRAMES` (constants); `splitSeries(camera, frames)`, `isCandidate(series)`, `trimSeries(series, max?)`.

- [ ] **Step 1: Write `app/lib/prelude/types.ts`**

```ts
import type { SolarPhase } from '@/app/lib/solarPhase';

/** One archived frame, already read UTC-correct out of webcam_snapshots. */
export interface PreludeFrame {
  snapshotId: number;
  /** Epoch ms. Read as `captured_at AT TIME ZONE 'UTC'` — see the plan's constraints. */
  capturedAt: number;
  /** ai_regression_score, [0,1]. The one instrument the bank ranks on. */
  quality: number;
  /** ai_binary_score, [0,1]. Gates a series in, never ranks it. */
  binary: number;
  imageUrl: string;
}

/** The camera a series belongs to. */
export interface PreludeCamera {
  webcamId: number;
  /** `webcams.source`: 'windy', 'youtube' or 'custom'. Decides whether the series may be posted (spec §3a). */
  source: string;
  title: string;
  region: string | null;
  country: string | null;
  timezone: string | null;
  lat: number;
  lng: number;
}

/**
 * One camera through one solar event: the arc a carousel swipes through.
 * `peak`, `mean` and `peakIndex` are computed once at split time so ranking
 * and trimming never re-walk the frames.
 */
export interface PreludeSeries {
  camera: PreludeCamera;
  phase: SolarPhase;
  /** In capture order, oldest first. Always. */
  frames: PreludeFrame[];
  peak: number;
  mean: number;
  peakIndex: number;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// app/lib/prelude/series.test.ts
import { describe, it, expect } from 'vitest';
import { splitSeries, isCandidate, trimSeries, SERIES_GAP_MS } from './series';
import type { PreludeCamera, PreludeFrame } from './types';

// Seattle. Sunset ~19:40 PDT on 2026-09-04 = 02:40Z on 09-05; sunrise ~13:33Z.
const CAM: PreludeCamera = {
  webcamId: 1, source: 'windy', title: 'Crescent: Lake Crescent', region: 'Washington',
  country: 'United States', timezone: 'America/Los_Angeles', lat: 47.6062, lng: -122.3321,
};

const at = (iso: string, over: Partial<PreludeFrame> = {}): PreludeFrame => ({
  snapshotId: Date.parse(iso), capturedAt: Date.parse(iso),
  quality: 0.5, binary: 0.9, imageUrl: `https://x/${iso}.jpg`, ...over,
});

/** n frames every 10 minutes from `iso`, the house cadence. */
const run = (iso: string, n: number, over: (i: number) => Partial<PreludeFrame> = () => ({})) =>
  Array.from({ length: n }, (_, i) => at(new Date(Date.parse(iso) + i * 600_000).toISOString(), over(i)));

describe('splitSeries (spec §4)', () => {
  it('keeps a run at the 10-minute cadence as one series', () => {
    const out = splitSeries(CAM, run('2026-09-05T02:00:00Z', 8));
    expect(out).toHaveLength(1);
    expect(out[0].frames).toHaveLength(8);
    expect(out[0].phase).toBe('sunset');
  });

  it('splits on a gap over 45 minutes', () => {
    const a = run('2026-09-05T02:00:00Z', 4);
    const b = run('2026-09-05T03:30:00Z', 4); // 60 min after the last of `a`
    const out = splitSeries(CAM, [...a, ...b]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.frames.length)).toEqual([4, 4]);
  });

  it('does not split on a gap of exactly 45 minutes', () => {
    const frames = [at('2026-09-05T02:00:00Z'), at(new Date(Date.parse('2026-09-05T02:00:00Z') + SERIES_GAP_MS).toISOString())];
    expect(splitSeries(CAM, frames)).toHaveLength(1);
  });

  it('splits on a phase change even with no gap', () => {
    // 13:20Z is before sunrise and climbing; 02:30Z the same day is falling.
    const out = splitSeries(CAM, [at('2026-09-05T02:30:00Z'), at('2026-09-05T02:40:00Z'), at('2026-09-05T13:20:00Z')]);
    expect(out.map((s) => s.phase)).toEqual(['sunset', 'sunrise']);
  });

  it('computes peak, mean and peakIndex over the frames', () => {
    const out = splitSeries(CAM, run('2026-09-05T02:00:00Z', 3, (i) => ({ quality: [0.2, 0.9, 0.4][i] })));
    expect(out[0].peak).toBeCloseTo(0.9);
    expect(out[0].mean).toBeCloseTo(0.5);
    expect(out[0].peakIndex).toBe(1);
  });

  it('phases a polar camera by the altitude comparison, not the azimuth', () => {
    // Longyearbyen in May: the sun circles without setting, so an azimuth
    // rule breaks and the "is it climbing?" rule still works.
    const svalbard = { ...CAM, lat: 78.22, lng: 15.63, timezone: 'Arctic/Longyearbyen' };
    const out = splitSeries(svalbard, [at('2026-05-20T22:00:00Z'), at('2026-05-21T04:00:00Z')]);
    expect(out.map((s) => s.phase)).toEqual(['sunset', 'sunrise']);
  });

  it('reads a UTC timestamp as UTC — a naive local read would flip the phase', () => {
    // 02:30Z on 09-05 is a Seattle sunset. Read as if it were local (09:30Z) it is a sunrise.
    const out = splitSeries(CAM, [at('2026-09-05T02:30:00Z')]);
    expect(out[0].phase).toBe('sunset');
  });
});

describe('isCandidate (spec §4)', () => {
  const series = (frames: PreludeFrame[]) => splitSeries(CAM, frames)[0];

  it('accepts six frames with a binary max over the floor', () => {
    expect(isCandidate(series(run('2026-09-05T02:00:00Z', 6)))).toBe(true);
  });
  it('rejects five frames', () => {
    expect(isCandidate(series(run('2026-09-05T02:00:00Z', 5)))).toBe(false);
  });
  it('rejects a series whose best binary score is below 0.5', () => {
    expect(isCandidate(series(run('2026-09-05T02:00:00Z', 8, () => ({ binary: 0.49 }))))).toBe(false);
  });
  it('accepts when a single frame carries the binary score', () => {
    expect(isCandidate(series(run('2026-09-05T02:00:00Z', 8, (i) => ({ binary: i === 3 ? 0.8 : 0.1 }))))).toBe(true);
  });
  it('rejects the whole series when any frame has no image URL, rather than shortening it', () => {
    expect(isCandidate(series(run('2026-09-05T02:00:00Z', 8, (i) => (i === 2 ? { imageUrl: '' } : {}))))).toBe(false);
  });
});

describe('trimSeries (spec §4)', () => {
  it('leaves a series of ten or fewer alone', () => {
    const s = splitSeries(CAM, run('2026-09-05T02:00:00Z', 9))[0];
    expect(trimSeries(s)).toBe(s);
  });

  it('keeps the ten frames centred on the peak, in capture order', () => {
    const s = splitSeries(CAM, run('2026-09-05T02:00:00Z', 18, (i) => ({ quality: i === 12 ? 1 : 0.1 })))[0];
    const t = trimSeries(s);
    expect(t.frames).toHaveLength(10);
    expect(t.frames.map((f) => f.capturedAt)).toEqual(t.frames.map((f) => f.capturedAt).sort((a, b) => a - b));
    expect(t.frames.some((f) => f.quality === 1)).toBe(true);
    expect(t.peakIndex).toBe(t.frames.findIndex((f) => f.quality === 1));
  });

  it('clamps the window at the start when the peak is the first frame', () => {
    const s = splitSeries(CAM, run('2026-09-05T02:00:00Z', 18, (i) => ({ quality: i === 0 ? 1 : 0.1 })))[0];
    const t = trimSeries(s);
    expect(t.frames).toHaveLength(10);
    expect(t.frames[0].capturedAt).toBe(s.frames[0].capturedAt);
    expect(t.peakIndex).toBe(0);
  });

  it('clamps the window at the end when the peak is the last frame', () => {
    const s = splitSeries(CAM, run('2026-09-05T02:00:00Z', 18, (i) => ({ quality: i === 17 ? 1 : 0.1 })))[0];
    const t = trimSeries(s);
    expect(t.frames).toHaveLength(10);
    expect(t.frames[9].capturedAt).toBe(s.frames[17].capturedAt);
    expect(t.peakIndex).toBe(9);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run app/lib/prelude/series.test.ts`
Expected: FAIL, cannot resolve `./series`.

- [ ] **Step 4: Write `app/lib/prelude/series.ts`**

```ts
import { solarPhaseAt } from '@/app/lib/solarPhase';
import type { PreludeCamera, PreludeFrame, PreludeSeries } from './types';

/**
 * A camera's frames through one sunrise or one sunset — the arc an Instagram
 * carousel swipes through (spec §4).
 *
 * A camera-day is not a series: it spans 9.4 hours at the median and holds a
 * sunrise, a sunset and the daylight between them. The break is a long gap or
 * a change in which way the sun is going.
 */

/** Longer than this between frames and it is a different event. The measured cadence is 10.3 minutes. */
export const SERIES_GAP_MS = 45 * 60_000;
/** Fewer frames than this is not an arc worth swiping. */
export const MIN_FRAMES = 6;
/** The detector has to agree something happened. */
export const MIN_BINARY = 0.5;
/** Ten frames ten minutes apart is eighty minutes of sky; past that a carousel is a chore. */
export const MAX_FRAMES = 10;

function summarise(camera: PreludeCamera, phase: PreludeSeries['phase'], frames: PreludeFrame[]): PreludeSeries {
  let peak = -Infinity, peakIndex = 0, total = 0;
  frames.forEach((f, i) => {
    total += f.quality;
    if (f.quality > peak) { peak = f.quality; peakIndex = i; }
  });
  return { camera, phase, frames, peak, mean: total / frames.length, peakIndex };
}

/**
 * Split one camera's frames, given in capture order, into series.
 * A new series starts on a gap over `SERIES_GAP_MS` or on a phase change.
 */
export function splitSeries(camera: PreludeCamera, frames: PreludeFrame[]): PreludeSeries[] {
  const out: PreludeSeries[] = [];
  let bucket: PreludeFrame[] = [];
  let phase: PreludeSeries['phase'] | null = null;

  for (const f of frames) {
    const p = solarPhaseAt(new Date(f.capturedAt), camera.lat, camera.lng);
    const last = bucket[bucket.length - 1];
    const broke = last != null && (f.capturedAt - last.capturedAt > SERIES_GAP_MS || p !== phase);
    if (broke) { out.push(summarise(camera, phase!, bucket)); bucket = []; }
    if (bucket.length === 0) phase = p;
    bucket.push(f);
  }
  if (bucket.length > 0) out.push(summarise(camera, phase!, bucket));
  return out;
}

/** A series worth posting: long enough, detected, and whole. */
export function isCandidate(s: PreludeSeries): boolean {
  if (s.frames.length < MIN_FRAMES) return false;
  if (s.frames.some((f) => !f.imageUrl)) return false;
  return s.frames.some((f) => f.binary >= MIN_BINARY);
}

/**
 * The `max` frames centred on the peak, still in capture order. The window
 * slides rather than shrinks when the peak sits near either end, so a trimmed
 * series always has `max` frames.
 */
export function trimSeries(s: PreludeSeries, max: number = MAX_FRAMES): PreludeSeries {
  if (s.frames.length <= max) return s;
  const start = Math.min(Math.max(0, s.peakIndex - Math.floor(max / 2)), s.frames.length - max);
  return summarise(s.camera, s.phase, s.frames.slice(start, start + max));
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run app/lib/prelude/series.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add app/lib/prelude/types.ts app/lib/prelude/series.ts app/lib/prelude/series.test.ts
git commit -m "feat(prelude): a camera through one solar event is a series"
```

---

### Task 2: Ranking series into a bank

**Files:**
- Create: `app/lib/prelude/bank.ts`
- Test: `app/lib/prelude/bank.test.ts`

**Interfaces:**
- Consumes: `PreludeSeries` from `./types`.
- Produces: `BANK_LIMIT`, `seriesScore(series): number`, `buildBank(series, opts?): PreludeSeries[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/prelude/bank.test.ts
import { describe, it, expect } from 'vitest';
import { seriesScore, buildBank } from './bank';
import type { PreludeCamera, PreludeSeries } from './types';

const cam = (webcamId: number): PreludeCamera => ({
  webcamId, source: 'windy', title: `Camera ${webcamId}`, region: null, country: 'Chile',
  timezone: 'America/Santiago', lat: -27.1, lng: -109.4,
});

const series = (webcamId: number, peak: number, mean: number): PreludeSeries => ({
  camera: cam(webcamId), phase: 'sunset', frames: [], peak, mean, peakIndex: 0,
});

describe('seriesScore (spec §5)', () => {
  it('is half the peak and half the mean', () => {
    expect(seriesScore(series(1, 0.9, 0.5))).toBeCloseTo(0.7);
  });

  it('ranks a steady series above one lucky frame', () => {
    // The measured case: an Alaska highway camera, peak 0.967, mean 0.491.
    const lucky = series(1, 0.967, 0.491);
    const steady = series(2, 0.87, 0.84);
    expect(seriesScore(steady)).toBeGreaterThan(seriesScore(lucky));
  });
});

describe('buildBank (spec §5)', () => {
  it('returns the highest scoring series first', () => {
    const out = buildBank([series(1, 0.5, 0.5), series(2, 0.9, 0.9), series(3, 0.7, 0.7)]);
    expect(out.map((s) => s.camera.webcamId)).toEqual([2, 3, 1]);
  });

  it('takes one series per camera and reaches down for the next camera', () => {
    // Camera 1 owns the top three; the bank must still show camera 2.
    const out = buildBank([
      series(1, 0.99, 0.9), series(1, 0.98, 0.9), series(1, 0.97, 0.9), series(2, 0.5, 0.5),
    ], { limit: 2 });
    expect(out.map((s) => s.camera.webcamId)).toEqual([1, 2]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => series(i, 0.9 - i / 100, 0.9));
    expect(buildBank(many, { limit: 20 })).toHaveLength(20);
  });

  it('defaults the limit to twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => series(i, 0.9 - i / 100, 0.9));
    expect(buildBank(many)).toHaveLength(20);
  });

  it('returns what it has rather than padding when candidates run short', () => {
    expect(buildBank([series(1, 0.9, 0.9), series(2, 0.8, 0.8)], { limit: 20 })).toHaveLength(2);
  });

  it('does not mutate the input order', () => {
    const input = [series(1, 0.1, 0.1), series(2, 0.9, 0.9)];
    buildBank(input);
    expect(input.map((s) => s.camera.webcamId)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run app/lib/prelude/bank.test.ts`
Expected: FAIL, cannot resolve `./bank`.

- [ ] **Step 3: Write `app/lib/prelude/bank.ts`**

```ts
import type { PreludeSeries } from './types';

/**
 * The bank: the best series in a window, one per camera (spec §5).
 *
 * Two measured facts shape this. Ranking on the peak alone promoted a series
 * whose mean was 0.491 — seven dull frames and one good one, which is a bad
 * carousel because a carousel is judged by all of its frames. And without a
 * per-camera cap, three of the top eight sunrises were the same North Dakota
 * camera; a feed of three cameras is not a feed.
 */

export const BANK_LIMIT = 20;

/** Half the best frame, half the whole arc. */
export const seriesScore = (s: PreludeSeries): number => 0.5 * s.peak + 0.5 * s.mean;

export function buildBank(
  series: PreludeSeries[], { limit = BANK_LIMIT }: { limit?: number } = {},
): PreludeSeries[] {
  const ranked = [...series].sort((a, b) => seriesScore(b) - seriesScore(a));
  const taken = new Set<number>();
  const bank: PreludeSeries[] = [];
  for (const s of ranked) {
    if (bank.length >= limit) break;
    if (taken.has(s.camera.webcamId)) continue;
    taken.add(s.camera.webcamId);
    bank.push(s);
  }
  return bank;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run app/lib/prelude/bank.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/prelude/bank.ts app/lib/prelude/bank.test.ts
git commit -m "feat(prelude): rank series into a bank, one per camera"
```

---

### Task 3: The post caption

**Files:**
- Create: `app/lib/prelude/caption.ts`
- Test: `app/lib/prelude/caption.test.ts`

**Interfaces:**
- Consumes: `captionLines`, `CaptionEntry` from `@/app/lib/solo/caption`; `sunAltitudeDeg` from `@/app/lib/solarPhase`; `PreludeSeries` from `./types`.
- Produces: `CARD_DIALS`, `cardEntry(series, index): CaptionEntry`, `cardLines(series, index)`, `postCaption(series): string`.

Why this shape: the *words* come from the glass's own caption module, which is
pure and already tested, so the feed and the glass speak the same language.
Only the extra sentence about the arc is written here.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/prelude/caption.test.ts
import { describe, it, expect } from 'vitest';
import { cardEntry, cardLines, postCaption } from './caption';
import type { PreludeCamera, PreludeFrame, PreludeSeries } from './types';

const CAM: PreludeCamera = {
  webcamId: 9, source: 'windy', title: 'Easter Island › North-west: Mataveri International Airport',
  region: 'Valparaíso', country: 'Chile', timezone: 'Pacific/Easter', lat: -27.1648, lng: -109.4269,
};

const frames: PreludeFrame[] = Array.from({ length: 8 }, (_, i) => ({
  snapshotId: 100 + i,
  capturedAt: Date.parse('2026-09-05T23:00:00Z') + i * 600_000,
  quality: i === 5 ? 0.98 : 0.6, binary: 0.99, imageUrl: `https://x/${i}.jpg`,
}));

const S: PreludeSeries = { camera: CAM, phase: 'sunset', frames, peak: 0.98, mean: 0.65, peakIndex: 5 };

describe('cardEntry (spec §7)', () => {
  it('carries the frame it is for, not the peak', () => {
    expect(cardEntry(S, 2).capturedAt).toBe(frames[2].capturedAt);
  });
  it('computes the sun altitude at that frame from the camera position', () => {
    const a = cardEntry(S, 0).sunAltitudeDeg;
    expect(a).not.toBeNull();
    expect(Math.abs(a!)).toBeLessThan(90);
  });
  it('coerces a null region and country to empty strings', () => {
    const bare = { ...S, camera: { ...CAM, region: null, country: null } };
    expect(cardEntry(bare, 0).region).toBe('');
    expect(cardEntry(bare, 0).country).toBe('');
  });
});

describe('cardLines (spec §7)', () => {
  it('prefixes the title with the phase', () => {
    expect(cardLines(S, 5)!.title.startsWith('Sunset: ')).toBe(true);
  });
  it('names the place', () => {
    expect(cardLines(S, 5)!.place).toContain('Chile');
  });
  it('writes the local clock and the sun together', () => {
    const time = cardLines(S, 5)!.time;
    expect(time).toMatch(/\d:\d\d (am|pm)/);
    expect(time).toContain('horizon');
  });
  it('never prints a model score', () => {
    const l = cardLines(S, 5)!;
    expect(`${l.title} ${l.place} ${l.time}`).not.toContain('0.98');
  });
});

describe('postCaption (spec §7)', () => {
  it('opens with the phase-prefixed title and the place', () => {
    const c = postCaption(S);
    expect(c.startsWith('Sunset: ')).toBe(true);
    expect(c).toContain('Chile');
  });
  it('says how many frames and over how long', () => {
    const c = postCaption(S);
    expect(c).toContain('8 frames');
    expect(c).toContain('70 minutes'); // 7 gaps of 10 minutes
  });
  it('carries no model score anywhere', () => {
    const c = postCaption(S);
    expect(c).not.toContain('0.98'); // peak
    expect(c).not.toContain('0.65'); // mean
  });
  it('describes a sunrise as brightening and a sunset as darkening', () => {
    expect(postCaption(S)).toContain('darkens');
    expect(postCaption({ ...S, phase: 'sunrise' })).toContain('brightens');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run app/lib/prelude/caption.test.ts`
Expected: FAIL, cannot resolve `./caption`.

- [ ] **Step 3: Write `app/lib/prelude/caption.ts`**

```ts
import { captionLines, type CaptionEntry, type CaptionLines } from '@/app/lib/solo/caption';
import { sunAltitudeDeg } from '@/app/lib/solarPhase';
import type { PreludeSeries } from './types';

/**
 * What a card and a post say (spec §7).
 *
 * The words come from `app/lib/solo/caption.ts`, the glass's own module, so
 * the feed and the glass speak the same language and neither drifts. Only the
 * sentence about the arc is written here.
 *
 * No model score anywhere. It is an internal instrument on a scale nobody
 * outside the project can read, and printing it invites arguing with the
 * number instead of looking at the picture. The score lives in the manifest.
 */

/** The dials the card is drawn with: place on, title tidied, clock beside the sun. */
export const CARD_DIALS = {
  showPlace: true as const,
  timeStyle: '12h-sun' as const,
  titleClean: 'spot' as const,
  feedPrefix: true as const,
};

/** The caption module's view of one frame in the series. */
export function cardEntry(s: PreludeSeries, index: number): CaptionEntry {
  const f = s.frames[index];
  return {
    title: s.camera.title,
    region: s.camera.region ?? '',
    country: s.camera.country ?? '',
    capturedAt: f.capturedAt,
    timezone: s.camera.timezone,
    sunAltitudeDeg: sunAltitudeDeg(new Date(f.capturedAt), s.camera.lat, s.camera.lng),
  };
}

/** The lines drawn under one card. */
export const cardLines = (s: PreludeSeries, index: number): CaptionLines | null =>
  captionLines(cardEntry(s, index), CARD_DIALS, s.phase);

/** The whole post caption, ready to paste. */
export function postCaption(s: PreludeSeries): string {
  const lines = cardLines(s, s.peakIndex)!;
  const spanMs = s.frames[s.frames.length - 1].capturedAt - s.frames[0].capturedAt;
  const minutes = Math.round(spanMs / 60_000);
  const verb = s.phase === 'sunrise' ? 'brightens' : 'darkens';
  const parts = [
    lines.title,
    lines.place,
    '',
    `${s.frames.length} frames over ${minutes} minutes, oldest first. Swipe and it ${verb}.`,
  ];
  if (lines.time) parts.push(lines.time);
  return parts.join('\n');
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run app/lib/prelude/caption.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/prelude/caption.ts app/lib/prelude/caption.test.ts
git commit -m "feat(prelude): the post says what the glass says"
```

---

### Task 4: Laying out and rendering the card

**Files:**
- Create: `app/lib/prelude/card.ts`
- Test: `app/lib/prelude/card.test.ts`

**Interfaces:**
- Consumes: `CaptionLines` from `@/app/lib/solo/caption`; `sharp`.
- Produces: `CARD`, `SOURCE`, `PICTURE_SCALE`, `STAMP_BAND`, `cardLayout(source?, scale?)`, `renderCard(frameJpeg, lines, { scale?, stamp? })`.

Why the picture is small: every archived frame is 400 by 224 and about 15KB.
A 2.7x upscale of that, full-screen on a phone, looks like a mistake. Drawn
inside a dark card with the caption below, the same pixels read as a choice.
The scale is a parameter because the source decides it: Windy's terms allow
"only the original or smaller Webcam image size", so a Windy frame is drawn at
1x, and a postable source at up to 2x. A practice card carries a red stamp so
it cannot be mistaken for one to post. Spec §3a and §6.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/prelude/card.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { cardLayout, renderCard, CARD, SOURCE, STAMP_BAND } from './card';

const LINES = {
  title: 'Sunset: Mataveri International Airport',
  place: 'Easter Island, Valparaíso, Chile',
  time: '7:42 pm · sun 3.1° below the horizon',
  timeParts: [], sub: '',
};

const frame = () => sharp({
  create: { width: SOURCE.width, height: SOURCE.height, channels: 3, background: '#c04a1e' },
}).jpeg().toBuffer();

describe('cardLayout (spec §6)', () => {
  it('draws the frame at 2x, well inside a 1080 by 1350 card', () => {
    const l = cardLayout();
    expect(CARD).toEqual({ width: 1080, height: 1350 });
    expect(l.picture.width).toBe(800);
    expect(l.picture.height).toBe(448);
    expect(l.picture.width).toBeLessThan(CARD.width);
  });

  it('never upscales the frame to the card width', () => {
    expect(cardLayout().picture.width).toBeLessThan(CARD.width);
  });

  it('centres the picture horizontally', () => {
    const l = cardLayout();
    expect(l.picture.left).toBe((CARD.width - l.picture.width) / 2);
    expect(l.picture.left).toBeGreaterThan(0);
  });

  it('puts the caption below the picture, inside the card', () => {
    const l = cardLayout();
    expect(l.captionTop).toBeGreaterThan(l.picture.top + l.picture.height);
    expect(l.captionTop).toBeLessThan(CARD.height);
  });

  it('keeps the source aspect for a frame of another size', () => {
    const l = cardLayout({ width: 640, height: 360 });
    expect(l.picture.width / l.picture.height).toBeCloseTo(640 / 360, 2);
    expect(l.picture.width).toBeLessThanOrEqual(CARD.width - 80);
  });

  it('draws a frame at its stored size when the scale is 1', () => {
    const l = cardLayout(SOURCE, 1);
    expect(l.picture.width).toBe(400);
    expect(l.picture.height).toBe(224);
  });
});

describe('renderCard (spec §6)', () => {
  it('produces a 1080 by 1350 JPEG', async () => {
    const out = await renderCard(await frame(), LINES);
    const m = await sharp(out).metadata();
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1350);
    expect(m.format).toBe('jpeg');
  });

  it('keeps the ground dark in the corner, away from the picture', async () => {
    const out = await renderCard(await frame(), LINES);
    const { data } = await sharp(out).extract({ left: 0, top: 0, width: 20, height: 20 })
      .raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeLessThan(40);
  });

  it('escapes XML-special characters in a title rather than producing broken SVG', async () => {
    const out = await renderCard(await frame(), { ...LINES, title: 'Ben & Jerry <Point>' });
    expect((await sharp(out).metadata()).width).toBe(1080);
  });

  it('paints a practice stamp across the top of the card', async () => {
    const out = await renderCard(await frame(), LINES, { stamp: 'NOT FOR POSTING · Windy' });
    const { data } = await sharp(out).extract({ left: 0, top: 0, width: 20, height: 20 })
      .raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(150);
  });

  it('keeps the stamp clear of the picture at either scale', () => {
    expect(cardLayout(SOURCE, 1).picture.top).toBeGreaterThan(STAMP_BAND);
    expect(cardLayout(SOURCE, 2).picture.top).toBeGreaterThan(STAMP_BAND);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run app/lib/prelude/card.test.ts`
Expected: FAIL, cannot resolve `./card`.

- [ ] **Step 3: Write `app/lib/prelude/card.ts`**

```ts
import sharp from 'sharp';
import type { CaptionLines } from '@/app/lib/solo/caption';

/**
 * One Instagram card: the frame inset on a dark ground with the caption
 * below (spec §6). This is the solo kiosk's inset composition, so the feed
 * and the glass look like the same object.
 *
 * The layout is re-expressed as SVG rather than rendered from the React
 * components. The words are the part worth sharing and they come from
 * `app/lib/solo/caption.ts`; the layout is thirty lines and a headless
 * browser is not worth carrying for it.
 */

/** Instagram 4:5 portrait. */
export const CARD = { width: 1080, height: 1350 } as const;
/** What the archive stores. Windy offers nothing larger for a past frame. */
export const SOURCE = { width: 400, height: 224 } as const;
/** The most a frame is ever drawn at. A source's posting rule can lower it (spec §3a). */
export const PICTURE_SCALE = 2;
/** Height of the red practice stamp across the top of the card. */
export const STAMP_BAND = 96;
/** The least dark ground either side of the picture. */
const MIN_MARGIN = 40;
const GAP_BELOW_PICTURE = 96;
const INK = { title: '#f2efe9', place: '#a8a29a', time: '#7d786f', stamp: '#e5484d' };
const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export interface CardLayout {
  picture: { left: number; top: number; width: number; height: number };
  captionTop: number;
}

/**
 * Where the picture and the caption sit. The picture is drawn at `scale`,
 * never above `PICTURE_SCALE`, clamped so it never fills the card's width, and
 * the block of picture plus caption is centred vertically.
 */
export function cardLayout(
  source: { width: number; height: number } = SOURCE, scale: number = PICTURE_SCALE,
): CardLayout {
  const maxWidth = CARD.width - MIN_MARGIN * 2;
  const width = Math.min(Math.round(source.width * Math.min(scale, PICTURE_SCALE)), maxWidth);
  const height = Math.round((width / source.width) * source.height);
  const captionHeight = 220;
  const block = height + GAP_BELOW_PICTURE + captionHeight;
  const top = Math.round((CARD.height - block) / 2);
  return {
    picture: { left: Math.round((CARD.width - width) / 2), top, width, height },
    captionTop: top + height + GAP_BELOW_PICTURE,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The caption as an SVG overlay the size of the whole card. */
function captionSvg(lines: CaptionLines, l: CardLayout): Buffer {
  const cx = CARD.width / 2;
  const row = (text: string, dy: number, size: number, fill: string, weight: number) =>
    text ? `<text x="${cx}" y="${l.captionTop + dy}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>` : '';
  return Buffer.from(
    `<svg width="${CARD.width}" height="${CARD.height}" xmlns="http://www.w3.org/2000/svg">` +
    row(lines.title, 0, 46, INK.title, 500) +
    row(lines.place, 62, 32, INK.place, 400) +
    row(lines.time, 116, 28, INK.time, 400) +
    `</svg>`,
  );
}

/** A red band across the top, so a practice card cannot be mistaken for one to post. */
function stampSvg(text: string): Buffer {
  return Buffer.from(
    `<svg width="${CARD.width}" height="${STAMP_BAND}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${CARD.width}" height="${STAMP_BAND}" fill="${INK.stamp}"/>` +
    `<text x="${CARD.width / 2}" y="${STAMP_BAND / 2 + 14}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="#ffffff">${esc(text)}</text>` +
    `</svg>`,
  );
}

export interface RenderOptions {
  /** The most the frame may be drawn at. Pass the source's posting rule `maxScale`. */
  scale?: number;
  /** Printed across the top of a practice card. */
  stamp?: string;
}

/** One finished card. `frameJpeg` is the archived frame, bytes as stored. */
export async function renderCard(
  frameJpeg: Buffer, lines: CaptionLines, { scale = PICTURE_SCALE, stamp }: RenderOptions = {},
): Promise<Buffer> {
  const meta = await sharp(frameJpeg).metadata();
  const layout = cardLayout(
    meta.width && meta.height ? { width: meta.width, height: meta.height } : SOURCE,
    scale,
  );
  const picture = await sharp(frameJpeg)
    .resize(layout.picture.width, layout.picture.height, { fit: 'fill', kernel: 'lanczos3' })
    .toBuffer();

  return sharp({
    create: { width: CARD.width, height: CARD.height, channels: 3, background: '#121110' },
  })
    .composite([
      { input: picture, left: layout.picture.left, top: layout.picture.top },
      { input: captionSvg(lines, layout), left: 0, top: 0 },
      ...(stamp ? [{ input: stampSvg(stamp), left: 0, top: 0 }] : []),
    ])
    // Quality 90 without chroma subsampling, so the artefacts already in a
    // 15KB source are not compounded by the re-encode.
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run app/lib/prelude/card.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole prelude suite**

Run: `npx vitest run app/lib/prelude`
Expected: PASS, 46 tests.

- [ ] **Step 6: Commit**

```bash
git add app/lib/prelude/card.ts app/lib/prelude/card.test.ts
git commit -m "feat(prelude): a card insets the frame rather than stretching it"
```

---

### Task 5: Posting labels

**Files:**
- Create: `app/lib/prelude/postingRights.ts`
- Test: `app/lib/prelude/postingRights.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PostingLabel`, `PostingRule`, `POSTING_RULES`, `postingRuleFor(source)`, `destinationFor(rule)`, `creditLine(rule)`.

Why this is a module and not a comment: a label someone has to remember to
check eventually gets missed, and one Windy picture posted by mistake can cost
the map its Windy access. The script asks this module where every series goes,
and the only way into `ready/` is a rule that says so. Spec §3a.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/prelude/postingRights.test.ts
import { describe, it, expect } from 'vitest';
import { postingRuleFor, destinationFor, creditLine, type PostingRule } from './postingRights';

describe('postingRuleFor (spec §3a)', () => {
  it('labels Windy no_post, because its terms forbid redistribution', () => {
    expect(postingRuleFor('windy').label).toBe('no_post');
  });
  it('labels YouTube no_post until someone reads its terms', () => {
    expect(postingRuleFor('youtube').label).toBe('no_post');
  });
  it('labels our own camera postable', () => {
    expect(postingRuleFor('custom').label).toBe('post');
  });
  it('treats a source with no rule as no_post', () => {
    expect(postingRuleFor('faa').label).toBe('no_post');
  });
  it('treats a missing source as no_post', () => {
    expect(postingRuleFor(null).label).toBe('no_post');
    expect(postingRuleFor('').label).toBe('no_post');
  });
  it('never lets a Windy frame be drawn larger than stored', () => {
    expect(postingRuleFor('windy').maxScale).toBe(1);
  });
});

describe('destinationFor (spec §3a)', () => {
  it('sends only postable sources to ready/', () => {
    expect(destinationFor(postingRuleFor('windy'))).toBe('practice');
    expect(destinationFor(postingRuleFor('custom'))).toBe('ready');
    expect(destinationFor({ ...postingRuleFor('custom'), label: 'post_with_credit' })).toBe('ready');
  });
});

describe('creditLine (spec §3a)', () => {
  it('writes a credit only when the label asks for one', () => {
    const credited: PostingRule = {
      name: 'DriveBC', label: 'post_with_credit', maxScale: 2, credit: 'DriveBC', basis: 'example',
    };
    expect(creditLine(credited)).toBe('Credit: DriveBC');
    expect(creditLine(postingRuleFor('custom'))).toBeNull();
    expect(creditLine(postingRuleFor('windy'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run app/lib/prelude/postingRights.test.ts`
Expected: FAIL, cannot resolve `./postingRights`.

- [ ] **Step 3: Write `app/lib/prelude/postingRights.ts`**

```ts
/**
 * Whether a picture may leave the project, decided by where it came from
 * (spec §3a).
 *
 * The rule belongs to the source, not the picture: every frame from one
 * source carries the same permission. A source with no rule here is
 * `no_post`. Moving a source to `post` means someone has read its terms, and
 * `basis` says what they read and when.
 */

export type PostingLabel = 'post' | 'post_with_credit' | 'no_post';

export interface PostingRule {
  /** Printed on practice cards. */
  name: string;
  label: PostingLabel;
  /** The most a frame from this source may be drawn at. */
  maxScale: number;
  /** The words a `post_with_credit` caption must carry. */
  credit?: string;
  /** What was read to decide the label, and when. */
  basis: string;
}

/** Keyed by `webcams.source`. */
export const POSTING_RULES: Readonly<Record<string, PostingRule>> = {
  windy: {
    name: 'Windy', label: 'no_post', maxScale: 1,
    basis: 'Windy Webcams API terms, read 2026-09-15: "The User must not further redistribute the Content that they obtain via the API." They also allow "only the original or smaller Webcam image size".',
  },
  youtube: {
    name: 'YouTube', label: 'no_post', maxScale: 1,
    basis: 'Terms not read yet.',
  },
  custom: {
    name: 'Our camera', label: 'post', maxScale: 2,
    basis: 'Our own camera and our own pictures.',
  },
};

export function postingRuleFor(source: string | null | undefined): PostingRule {
  if (source && Object.prototype.hasOwnProperty.call(POSTING_RULES, source)) {
    return POSTING_RULES[source];
  }
  return {
    name: source ? `Unlabeled source (${source})` : 'Unlabeled source',
    label: 'no_post', maxScale: 1,
    basis: 'No rule recorded. Every source starts here until someone reads its terms.',
  };
}

/** The only way into `ready/` is a label that allows posting. */
export const destinationFor = (rule: PostingRule): 'ready' | 'practice' =>
  rule.label === 'no_post' ? 'practice' : 'ready';

/** The caption line a credited source requires, or null. */
export const creditLine = (rule: PostingRule): string | null =>
  rule.label === 'post_with_credit' ? `Credit: ${rule.credit ?? rule.name}` : null;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run app/lib/prelude/postingRights.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole prelude suite**

Run: `npx vitest run app/lib/prelude`
Expected: PASS, 54 tests.

- [ ] **Step 6: Commit**

```bash
git add app/lib/prelude/postingRights.ts app/lib/prelude/postingRights.test.ts
git commit -m "feat(prelude): a picture's source decides whether it may be posted"
```

---

### Task 6: The script

**Files:**
- Create: `scripts/prelude-bank.ts`
- Modify: `package.json` (add the `prelude:bank` script)

**Interfaces:**
- Consumes: everything from `app/lib/prelude/`.
- Produces: directories under `out/prelude/<date>/<ready|practice>/<phase>-<rank>-<slug>/` holding `01.jpg`…`10.jpg`, `caption.txt`, `manifest.json`.

`out/` is already in `.gitignore`. Run with vite-node, matching
`scripts/solo-replay.ts`. Read-only against production.

- [ ] **Step 1: Write `scripts/prelude-bank.ts`**

```ts
// scripts/prelude-bank.ts — the Instagram prelude bank
// (docs/superpowers/specs/2026-09-08-instagram-prelude-bank-design.md).
//
// Reads the archive, clusters each camera's frames into series, ranks them
// into a bank of twenty per phase, and writes Instagram-ready cards and
// captions to out/prelude/. Nothing is published; a human posts them, and only
// from ready/. A series whose source may not be posted goes to practice/ with
// every card stamped (spec §3a).
//
//   npx vite-node --config vitest.config.ts scripts/prelude-bank.ts \
//     --days 7 --limit 20
//
//   --days   how far back to look (default 7)
//   --limit  series per phase (default 20)
//   --out    output root (default out/prelude)
//
// Read-only. Needs DATABASE_URL in .env.local.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { splitSeries, isCandidate, trimSeries } from '../app/lib/prelude/series';
import { buildBank, seriesScore } from '../app/lib/prelude/bank';
import { cardLines, postCaption } from '../app/lib/prelude/caption';
import { renderCard } from '../app/lib/prelude/card';
import { postingRuleFor, destinationFor, creditLine } from '../app/lib/prelude/postingRights';
import type { PreludeCamera, PreludeFrame, PreludeSeries } from '../app/lib/prelude/types';
import type { SolarPhase } from '../app/lib/solarPhase';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const days = Number(arg('days', '7'));
const limit = Number(arg('limit', '20'));
const outRoot = arg('out', 'out/prelude');

const env = readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').filter((l) => l.startsWith('DATABASE_URL='))
  .pop()!.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const sql = neon(dbUrl);

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ⚠️ captured_at is `timestamp WITHOUT time zone` holding UTC digits and the
// Neon driver shifts it by the server's offset. Read it AT TIME ZONE 'UTC'
// or every sun altitude — and so every phase — is hours wrong.
const rows = await sql`
  SELECT s.id, s.webcam_id, (s.captured_at AT TIME ZONE 'UTC') AS at,
         s.ai_regression_score AS quality, s.ai_binary_score AS binary, s.firebase_url,
         w.source, w.title, w.region, w.country, w.timezone, w.lat, w.lng
  FROM webcam_snapshots s
  JOIN webcams w ON w.id = s.webcam_id
  WHERE s.captured_at > now() - make_interval(days => ${days}::int)
    AND w.lat IS NOT NULL AND w.lng IS NOT NULL
    AND s.ai_regression_score IS NOT NULL
  ORDER BY s.webcam_id, s.captured_at
`;
console.log(`read ${rows.length} frames over ${days} days`);

const byCamera = new Map<number, { camera: PreludeCamera; frames: PreludeFrame[] }>();
for (const r of rows as Record<string, unknown>[]) {
  const id = Number(r.webcam_id);
  if (!byCamera.has(id)) {
    byCamera.set(id, {
      camera: {
        webcamId: id, source: String(r.source ?? ''), title: String(r.title ?? ''),
        region: (r.region as string) ?? null, country: (r.country as string) ?? null,
        timezone: (r.timezone as string) ?? null,
        // NUMERIC(9,6) comes back from the Neon driver as a string.
        lat: Number(r.lat), lng: Number(r.lng),
      },
      frames: [],
    });
  }
  byCamera.get(id)!.frames.push({
    snapshotId: Number(r.id),
    capturedAt: new Date(r.at as string | Date).getTime(),
    quality: Number(r.quality), binary: Number(r.binary ?? 0),
    imageUrl: String(r.firebase_url ?? ''),
  });
}

const candidates: PreludeSeries[] = [];
for (const { camera, frames } of byCamera.values()) {
  for (const s of splitSeries(camera, frames)) if (isCandidate(s)) candidates.push(trimSeries(s));
}
console.log(`series: ${candidates.length} candidates from ${byCamera.size} cameras`);

const today = new Date().toISOString().slice(0, 10);
for (const phase of ['sunrise', 'sunset'] as SolarPhase[]) {
  const bank = buildBank(candidates.filter((s) => s.phase === phase), { limit });
  console.log(`\n${phase}: ${bank.length} in the bank`);

  for (const [i, s] of bank.entries()) {
    const rank = String(i + 1).padStart(2, '0');
    // Where a series goes is the posting rule's call, never this loop's.
    const rule = postingRuleFor(s.camera.source);
    const destination = destinationFor(rule);
    const stamp = destination === 'practice' ? `NOT FOR POSTING · ${rule.name}` : undefined;
    const dir = join(outRoot, today, destination, `${phase}-${rank}-${slug(s.camera.title)}`);
    mkdirSync(dir, { recursive: true });

    for (const [j, f] of s.frames.entries()) {
      const res = await fetch(f.imageUrl);
      if (!res.ok) throw new Error(`${f.imageUrl} → ${res.status}`);
      const card = await renderCard(Buffer.from(await res.arrayBuffer()), cardLines(s, j)!, {
        scale: rule.maxScale, stamp,
      });
      writeFileSync(join(dir, `${String(j + 1).padStart(2, '0')}.jpg`), card);
    }

    const credit = creditLine(rule);
    writeFileSync(join(dir, 'caption.txt'), postCaption(s) + (credit ? `\n${credit}` : '') + '\n');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      phase, rank: i + 1, webcamId: s.camera.webcamId, title: s.camera.title,
      source: s.camera.source, postingLabel: rule.label, destination, postingBasis: rule.basis,
      country: s.camera.country, score: seriesScore(s), peak: s.peak, mean: s.mean,
      frames: s.frames.map((f) => ({
        snapshotId: f.snapshotId, capturedAt: new Date(f.capturedAt).toISOString(),
        quality: f.quality, binary: f.binary, imageUrl: f.imageUrl,
      })),
    }, null, 2) + '\n');

    console.log(`  ${rank}. [${destination}] ${s.camera.title.slice(0, 40)} — ${s.frames.length} frames → ${dir}`);
  }
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, beside `migrate:status`:

```json
"prelude:bank": "npx vite-node --config vitest.config.ts scripts/prelude-bank.ts"
```

- [ ] **Step 3: Run it against production, small**

Run: `npm run prelude:bank -- --days 2 --limit 2`
Expected: it prints a frame count, a candidate count, then two sunrise and two sunset directories, each holding numbered JPEGs, `caption.txt` and `manifest.json`. Today every one lands under `practice/`: Windy is `no_post` and no postable source has frames yet.

- [ ] **Step 4: Look at the output**

Open the JPEGs. Check by eye that the picture is inset on a dark ground and not stretched, the title and place are legible, the frames are oldest first, and the caption in `caption.txt` reads well. Every `practice/` card must carry the red stamp, and a Windy picture must sit at its stored 400 by 224. This is the step the whole hand-posted stage exists for.

- [ ] **Step 5: Run the full bank**

Run: `npm run prelude:bank`
Expected: twenty directories per phase under `out/prelude/<today>/`, split between `ready/` and `practice/` by source.

- [ ] **Step 6: Confirm nothing untracked leaked into git**

Run: `git status --porcelain`
Expected: only `package.json` and `scripts/prelude-bank.ts`. `out/` is ignored by `.gitignore:19`.

- [ ] **Step 7: Commit**

```bash
git add scripts/prelude-bank.ts package.json
git commit -m "feat(prelude): write the bank to disk, ready to post by hand"
```

---

## After the plan

Push the branch and open a PR. Per `CLAUDE.md`, verify the branch in the same
command as the commit, stage explicit paths, and remove the worktree once the
PR merges:

```bash
scripts/wt.sh rm docs/instagram-prelude-bank
```

No migration. No deploy. Nothing touches the glass, so no
`scripts/pi/kiosk-doctor.sh` run is needed.
