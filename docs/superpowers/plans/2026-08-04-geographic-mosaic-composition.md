# Geographic Mosaic Composition Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MosaicCanvas` everywhere with a pure, tested composition engine (`compose()`) + dumb renderer (`GeoMosaic`) implementing the geographic sparse↔dense layout from `docs/superpowers/specs/2026-08-04-geographic-mosaic-composition-design.md`.

**Architecture:** A one-file quality signal (`app/lib/qualitySignal.ts`), five pure engine modules under `app/components/GeoMosaic/engine/`, a canvas renderer with DOM setup-overlay, then three consumer swaps (kiosk sunrise, kiosk sunset, main-page mosaic modes) and deletion of `MosaicCanvas`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest + React Testing Library (jsdom), HTML5 Canvas. No new dependencies.

## Global Constraints

- Branch: all work on `feat/geo-mosaic-composition` (branched from current `main`). NEVER commit to `main`. Verify with `git branch --show-current` before every commit.
- Run tests with `env -u NODE_OPTIONS npx vitest run <paths>` and ALWAYS exclude the stale worktree: add `--exclude "**/.claude/**"` when running directories.
- New config constants go in `app/lib/masterConfig.ts` exactly as named in the spec: `COMPOSITION_TILE_FLOOR_PX = 100`, `COMPOSITION_TILE_CEIL_PX = 300`, `COMPOSITION_UPSCALE_MAX = 1.5`, `COMPOSITION_LAT_WINDOW: [number, number] = [70, -60]`, `COMPOSITION_MAX_GROWTH = 2.0`, `COMPOSITION_CULL_OVERFLOW = true`.
- The engine is pure: no DOM, no `Image`, no `window` inside `engine/` files. Source image dimensions arrive as data.
- Unscored webcams are INCLUDED at percentile 0.5. No gating.
- TDD every task: failing test → minimal code → green → commit.

---

### Task 1: qualitySignal.ts — the one place that names the model

**Files:**
- Create: `app/lib/qualitySignal.ts`
- Test: `app/lib/qualitySignal.test.ts`

**Interfaces:**
- Consumes: `WindyWebcam` from `@/app/lib/types` (field `aiRatingRegression?: number`).
- Produces: `getQualityScore(webcam: WindyWebcam): number | null` — used by Task 2 and Task 6.

- [ ] **Step 1: Write the failing test** (`app/lib/qualitySignal.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { getQualityScore } from './qualitySignal';
import type { WindyWebcam } from './types';

const base = { webcamId: 1, viewCount: 0, location: { latitude: 0, longitude: 0 } } as WindyWebcam;

describe('getQualityScore', () => {
  it('returns aiRatingRegression when present', () => {
    expect(getQualityScore({ ...base, aiRatingRegression: 3.7 })).toBe(3.7);
  });
  it('returns null when no regression score (legacy aiRating is NOT used)', () => {
    expect(getQualityScore({ ...base, aiRating: 4.5 } as WindyWebcam)).toBeNull();
    expect(getQualityScore(base)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `env -u NODE_OPTIONS npx vitest run app/lib/qualitySignal.test.ts` → module not found.
- [ ] **Step 3: Implement** (`app/lib/qualitySignal.ts`):

```ts
import type { WindyWebcam } from './types';

/**
 * THE quality signal. The single place that decides which model's score
 * drives composition sizing. Today: the live v4 ONNX regression (1–5).
 * When a newer model ships, change this file and every surface follows.
 */
export function getQualityScore(webcam: WindyWebcam): number | null {
  return webcam.aiRatingRegression ?? null;
}
```

- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `git add app/lib/qualitySignal.ts app/lib/qualitySignal.test.ts && git commit -m "feat(geo-mosaic): add qualitySignal — single source of sizing model"`

---

### Task 2: engine/types.ts + percentileSize.ts

**Files:**
- Create: `app/components/GeoMosaic/engine/types.ts`
- Create: `app/components/GeoMosaic/engine/percentileSize.ts`
- Test: `app/components/GeoMosaic/engine/percentileSize.test.ts`

**Interfaces:**
- Produces (types.ts, used by ALL later tasks):

```ts
export interface TileInput {
  id: number;            // webcamId
  lat: number;
  lng: number;
  srcWidth: number;      // natural px of the loaded preview image
  srcHeight: number;
  score: number | null;  // from getQualityScore
}
export interface SizedTile extends TileInput {
  percentile: number;    // 0..1
  width: number;         // laid-out px
  height: number;
}
export interface CompositionConfig {
  floorPx: number;       // COMPOSITION_TILE_FLOOR_PX
  ceilPx: number;        // COMPOSITION_TILE_CEIL_PX
  upscaleMax: number;    // COMPOSITION_UPSCALE_MAX
  latWindow: [number, number]; // [northLat, southLat] e.g. [70, -60]
  maxGrowth: number;     // COMPOSITION_MAX_GROWTH
  cullOverflow: boolean; // COMPOSITION_CULL_OVERFLOW
  padding: number;       // px between tiles
}
export interface PlacedTile extends SizedTile { x: number; y: number; }
export interface Layout {
  tiles: PlacedTile[];
  dropped: number[];     // webcamIds culled by overflow
  viewport: { width: number; height: number };
}
```

- Produces (percentileSize.ts):
  - `computePercentiles(tiles: TileInput[]): Map<number, number>` — id → percentile. Scored tiles ranked ascending by score; percentile = rank/(scoredCount−1) (single scored tile → 1). Ties share the mean of their ranks' percentiles. Unscored → 0.5.
  - `preferredHeight(t: TileInput, percentile: number, cfg: CompositionConfig): number` — `min(floor + (ceil−floor)×percentile, srcHeight×upscaleMax)`. The upscale ceiling MAY go below the floor (quality beats legibility for tiny sources).
  - `sizeTiles(tiles: TileInput[], cfg: CompositionConfig): SizedTile[]` — applies both; width = height × (srcWidth/srcHeight).

- [ ] **Step 1: Failing tests** (`percentileSize.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { computePercentiles, preferredHeight, sizeTiles } from './percentileSize';
import type { TileInput, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 2 };
const t = (id: number, score: number | null, srcH = 400): TileInput =>
  ({ id, lat: 0, lng: 0, srcWidth: srcH * 1.78, srcHeight: srcH, score });

describe('computePercentiles', () => {
  it('ranks scored tiles 0..1 ascending', () => {
    const p = computePercentiles([t(1, 2.0), t(2, 3.0), t(3, 4.0)]);
    expect(p.get(1)).toBe(0); expect(p.get(2)).toBe(0.5); expect(p.get(3)).toBe(1);
  });
  it('unscored gets 0.5 regardless of scored distribution', () => {
    const p = computePercentiles([t(1, 5.0), t(2, null)]);
    expect(p.get(2)).toBe(0.5);
  });
  it('all-null pool → everyone 0.5', () => {
    const p = computePercentiles([t(1, null), t(2, null)]);
    expect(p.get(1)).toBe(0.5); expect(p.get(2)).toBe(0.5);
  });
  it('all-equal scores → everyone same percentile', () => {
    const p = computePercentiles([t(1, 3), t(2, 3), t(3, 3)]);
    expect(p.get(1)).toBe(p.get(2)); expect(p.get(2)).toBe(p.get(3));
  });
});

describe('preferredHeight', () => {
  it('maps percentile 0 → floor, 1 → ceil', () => {
    expect(preferredHeight(t(1, 2), 0, cfg)).toBe(100);
    expect(preferredHeight(t(1, 5), 1, cfg)).toBe(300);
  });
  it('upscale ceiling clamps, and may go below the floor for tiny sources', () => {
    expect(preferredHeight(t(1, 5, 112), 1, cfg)).toBe(168); // 112*1.5
    expect(preferredHeight(t(1, 5, 60), 1, cfg)).toBe(90);   // below floor, allowed
  });
});

describe('sizeTiles', () => {
  it('preserves aspect ratio', () => {
    const [s] = sizeTiles([t(1, 3, 400)], cfg);
    expect(s.width / s.height).toBeCloseTo(1.78, 1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** both files exactly per the interfaces above. Percentile with ties: sort scored by score; for each group of equal scores assign the mean of `rank/(n-1)` values; `n===1` → 1.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(geo-mosaic): engine types + percentile sizing`

---

### Task 3: engine/bandRows.ts — greedy N→S rows, W→E within

**Files:**
- Create: `app/components/GeoMosaic/engine/bandRows.ts`
- Test: `app/components/GeoMosaic/engine/bandRows.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Row { tiles: SizedTile[]; height: number; meanLat: number; totalWidth: number; }
export function formRows(tiles: SizedTile[], viewportWidth: number, padding: number): Row[];
```

  Sort input N→S (`lat` desc). Greedily fill a row until adding the next tile would exceed `viewportWidth` (tile widths + padding between). Every row keeps ≥1 tile even if wider than viewport (a single huge tile must not infinite-loop). After a row closes, sort its tiles W→E (`lng` asc). `height` = max tile height in row; `meanLat` = mean of tile lats; `totalWidth` = Σwidths + padding×(n−1).

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { formRows } from './bandRows';
import type { SizedTile } from './types';

const st = (id: number, lat: number, lng: number, w = 200, h = 100): SizedTile =>
  ({ id, lat, lng, srcWidth: w, srcHeight: h, score: null, percentile: 0.5, width: w, height: h });

describe('formRows', () => {
  it('orders rows north to south by construction', () => {
    const rows = formRows([st(1, -10, 0), st(2, 50, 0), st(3, 20, 0)], 450, 2);
    const meanLats = rows.map((r) => r.meanLat);
    expect([...meanLats].sort((a, b) => b - a)).toEqual(meanLats);
    expect(rows[0].tiles.map((t) => t.id)).toContain(2);
  });
  it('sorts west→east within a row', () => {
    const rows = formRows([st(1, 0, 30), st(2, 0, -120), st(3, 0, 5)], 1000, 2);
    expect(rows[0].tiles.map((t) => t.lng)).toEqual([-120, 5, 30]);
  });
  it('wraps when width exceeded; never empty rows; single oversize tile still places', () => {
    const rows = formRows([st(1, 10, 0, 800), st(2, 5, 0, 800)], 1000, 2);
    expect(rows).toHaveLength(2);
    const big = formRows([st(1, 0, 0, 5000)], 1000, 2);
    expect(big).toHaveLength(1);
    expect(big[0].tiles).toHaveLength(1);
  });
});
```

- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(geo-mosaic): greedy geographic row formation`

---

### Task 4: engine/overflow.ts — cull vs compress

**Files:**
- Create: `app/components/GeoMosaic/engine/overflow.ts`
- Test: `app/components/GeoMosaic/engine/overflow.test.ts`

**Interfaces:**
- Consumes: `formRows` (Task 3), `SizedTile`, `CompositionConfig`.
- Produces:

```ts
export interface FitResult { rows: Row[]; kept: SizedTile[]; dropped: number[]; }
export function fitToViewport(
  tiles: SizedTile[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): FitResult;
```

  Total stacked height = Σ row.height + padding×(rows−1). If it fits → return as-is.
  - `cullOverflow=true`: repeatedly remove the single lowest-percentile tile (ties: lower score first, then higher id for determinism), re-form rows, until fit. Never drop the final tile.
  - `cullOverflow=false`: binary-search / iterate a uniform scale factor s∈(0,1] on all tile widths+heights, clamped so no height goes below `floorPx` (tiles already below floor from upscale-cap stay put); re-form rows at each try; if even the all-at-floor layout overflows, fall back to culling from that state.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { fitToViewport } from './overflow';
import type { SizedTile, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 0 };
const st = (id: number, percentile: number, h = 200): SizedTile =>
  ({ id, lat: 0, lng: id, srcWidth: 400, srcHeight: 400, score: percentile * 5, percentile, width: h, height: h });

describe('fitToViewport (cull mode)', () => {
  it('returns unchanged when it fits', () => {
    const r = fitToViewport([st(1, 0.5)], { width: 1000, height: 1000 }, cfg);
    expect(r.dropped).toEqual([]);
  });
  it('drops lowest percentile first until fit', () => {
    // 3 tiles of 200px stacked in 1 column (viewport width 250) = 600 > 450 → drop one
    const r = fitToViewport([st(1, 0.9), st(2, 0.1), st(3, 0.5)], { width: 250, height: 450 }, cfg);
    expect(r.dropped).toEqual([2]);
    expect(r.kept.map((t) => t.id).sort()).toEqual([1, 3]);
  });
  it('never drops the last tile', () => {
    const r = fitToViewport([st(1, 0.5, 5000)], { width: 100, height: 100 }, cfg);
    expect(r.kept).toHaveLength(1);
  });
});

describe('fitToViewport (compress mode)', () => {
  const soft = { ...cfg, cullOverflow: false };
  it('compresses instead of dropping when possible', () => {
    const r = fitToViewport([st(1, 0.9), st(2, 0.1), st(3, 0.5)], { width: 250, height: 450 }, soft);
    expect(r.dropped).toEqual([]);
    for (const t of r.kept) expect(t.height).toBeGreaterThanOrEqual(100);
    const total = r.rows.reduce((a, row) => a + row.height, 0);
    expect(total).toBeLessThanOrEqual(450);
  });
  it('culls as last resort when even floor-size overflows', () => {
    const many = Array.from({ length: 30 }, (_, i) => st(i + 1, i / 29, 100));
    const r = fitToViewport(many, { width: 100, height: 350 }, soft);
    expect(r.dropped.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(geo-mosaic): overflow fitting — cull and compress modes`

---

### Task 5: engine/distributeSpace.ts — the sparse↔dense blend

**Files:**
- Create: `app/components/GeoMosaic/engine/distributeSpace.ts`
- Test: `app/components/GeoMosaic/engine/distributeSpace.test.ts`

**Interfaces:**
- Consumes: `Row` (Task 3), `CompositionConfig`.
- Produces:

```ts
export function placeTiles(
  rows: Row[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): PlacedTile[];
```

  **Vertical:** leftover `S = height − (Σ row.height + padding×(rows−1))` (if S<0 treat as 0). Gap weights from the FIXED lat window `[north, south]`: topGap = north − rows[0].meanLat; betweenGap_i = rows[i].meanLat − rows[i+1].meanLat; bottomGap = rows[last].meanLat − south. Negative weights clamp to 0. If all weights 0 → distribute S equally. Row y positions = cumulative: `y_0 = S×(topW/ΣW)`, then `y_{i+1} = y_i + h_i + padding + S×(w_i/ΣW)`.
  **Horizontal per row:** leftover `Sx = width − row.totalWidth` (clamp ≥0). Weights from the POOL's lng range [minLng, maxLng] across all rows: leftGap = tile[0].lng − minLng; betweens = lng deltas; rightGap = maxLng − last.lng. All-zero → center the row (equal left/right margins, tiles packed with padding). Tiles centered vertically within their row band.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { placeTiles } from './distributeSpace';
import { formRows } from './bandRows';
import type { SizedTile, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 0 };
const st = (id: number, lat: number, lng: number, w = 100, h = 100): SizedTile =>
  ({ id, lat, lng, srcWidth: w, srcHeight: h, score: null, percentile: 0.5, width: w, height: h });

describe('placeTiles vertical', () => {
  it('single tile lands at latitude-proportional y', () => {
    // lat 5 in window [70,-60]: fraction from top = (70-5)/130 = 0.5
    const rows = formRows([st(1, 5, 0)], 1000, 0);
    const [p] = placeTiles(rows, { width: 1000, height: 1000 }, cfg);
    // leftover S = 900; topGap weight 65, bottomGap 65 → y = 450
    expect(p.y).toBeCloseTo(450, 0);
  });
  it('dense layout (no leftover) stacks rows packed from top', () => {
    const tiles = Array.from({ length: 10 }, (_, i) => st(i, 60 - i * 10, 0, 1000, 100));
    const rows = formRows(tiles, 1000, 0);
    const placed = placeTiles(rows, { width: 1000, height: 1000 }, cfg);
    expect(Math.min(...placed.map((p) => p.y))).toBe(0);
  });
  it('row order & vertical spacing follows latitude gaps', () => {
    const rows = formRows([st(1, 60, 0), st(2, 50, 0), st(3, -50, 0)], 100, 0);
    const placed = placeTiles(rows, { width: 100, height: 1300 }, cfg);
    const y = (id: number) => placed.find((p) => p.id === id)!.y;
    expect(y(2) - y(1)).toBeLessThan(y(3) - y(2)); // 10° gap << 100° gap
  });
});

describe('placeTiles horizontal', () => {
  it('positions tiles by longitude gaps within pool range', () => {
    const rows = formRows([st(1, 0, -100), st(2, 0, 100)], 1000, 0);
    const placed = placeTiles(rows, { width: 1000, height: 200 }, cfg);
    const p1 = placed.find((p) => p.id === 1)!; const p2 = placed.find((p) => p.id === 2)!;
    expect(p1.x).toBe(0);                 // at pool min lng → left edge
    expect(p2.x + p2.width).toBeCloseTo(1000, 0); // pool max lng → right edge
  });
});
```

- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(geo-mosaic): latitude/longitude-gap space distribution`

---

### Task 6: engine/compose.ts — orchestration + sparse growth

**Files:**
- Create: `app/components/GeoMosaic/engine/compose.ts`
- Test: `app/components/GeoMosaic/engine/compose.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export function compose(
  tiles: TileInput[],
  viewport: { width: number; height: number },
  cfg: CompositionConfig
): Layout;
```

  Pipeline: (1) `computePercentiles` → (2) `sizeTiles` → (3) `formRows` → (4) if stacked height < viewport height, compute `k = min(viewportH / stackedH, cfg.maxGrowth)`, if k>1 multiply every tile's height (and width, preserving aspect) by k, re-clamp each at `srcHeight×upscaleMax`, re-`formRows` → (5) `fitToViewport` → (6) `placeTiles` → Layout `{ tiles, dropped, viewport }`. Empty input → `{ tiles: [], dropped: [], viewport }`.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { compose } from './compose';
import type { TileInput, CompositionConfig } from './types';

const cfg: CompositionConfig = { floorPx: 100, ceilPx: 300, upscaleMax: 1.5, latWindow: [70, -60], maxGrowth: 2, cullOverflow: true, padding: 2 };
const t = (id: number, lat: number, lng: number, score: number | null = 3): TileInput =>
  ({ id, lat, lng, srcWidth: 712, srcHeight: 400, score });

describe('compose', () => {
  it('empty pool → empty layout, no throw', () => {
    expect(compose([], { width: 1080, height: 1920 }, cfg).tiles).toEqual([]);
  });
  it('sparse pool grows tiles but never past upscale ceiling', () => {
    const layout = compose([t(1, 40, 0, 5), t(2, -20, 10, 1)], { width: 1080, height: 1920 }, cfg);
    for (const p of layout.tiles) expect(p.height).toBeLessThanOrEqual(400 * 1.5);
    expect(layout.tiles.length).toBe(2);
  });
  it('all tiles stay inside the viewport', () => {
    const many = Array.from({ length: 150 }, (_, i) => t(i, 60 - (i % 30) * 4, (i % 12) * 30 - 180, (i % 50) / 10));
    const layout = compose(many, { width: 1080, height: 1920 }, cfg);
    for (const p of layout.tiles) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(1920 + 0.5);
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x + p.width).toBeLessThanOrEqual(1080 + 0.5);
    }
  });
  it('overflow culls lowest percentile ids into dropped', () => {
    const many = Array.from({ length: 400 }, (_, i) => t(i, 60 - (i % 40) * 3, i % 360 - 180, (i % 40) / 8));
    const layout = compose(many, { width: 1080, height: 1920 }, cfg);
    expect(layout.dropped.length).toBeGreaterThan(0);
    expect(layout.tiles.length + layout.dropped.length).toBe(400);
  });
  it('higher percentile → taller tile (hierarchy visible)', () => {
    const layout = compose([t(1, 10, 0, 1), t(2, 10, 20, 5), t(3, 10, 40, 3)], { width: 2000, height: 400 }, cfg);
    const h = (id: number) => layout.tiles.find((p) => p.id === id)!.height;
    expect(h(2)).toBeGreaterThan(h(3));
    expect(h(3)).toBeGreaterThan(h(1));
  });
});
```

- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** — `feat(geo-mosaic): compose() orchestration with sparse growth`

---

### Task 7: masterConfig constants

**Files:**
- Modify: `app/lib/masterConfig.ts` (append near existing KIOSK_ constants)
- Test: append to `app/lib/masterConfig.test.ts`

**Interfaces:**
- Produces the six `COMPOSITION_*` constants from Global Constraints, plus:

```ts
export const COMPOSITION_CONFIG = {
  floorPx: COMPOSITION_TILE_FLOOR_PX,
  ceilPx: COMPOSITION_TILE_CEIL_PX,
  upscaleMax: COMPOSITION_UPSCALE_MAX,
  latWindow: COMPOSITION_LAT_WINDOW,
  maxGrowth: COMPOSITION_MAX_GROWTH,
  cullOverflow: COMPOSITION_CULL_OVERFLOW,
  padding: 2,
} satisfies CompositionConfig;
```

- [ ] **Step 1: failing test** asserting each constant's exact value and `COMPOSITION_CONFIG.floorPx === COMPOSITION_TILE_FLOOR_PX`. **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** — `feat(geo-mosaic): composition config constants`

---

### Task 8: GeoMosaic.tsx renderer + setup overlay

**Files:**
- Create: `app/components/GeoMosaic/GeoMosaic.tsx`
- Create: `app/components/GeoMosaic/SetupOverlay.tsx`
- Create: `app/components/GeoMosaic/useLoadedTiles.ts`
- Test: `app/components/GeoMosaic/GeoMosaic.test.tsx`

**Interfaces:**
- Consumes: `compose`, `COMPOSITION_CONFIG`, `getQualityScore`.
- Produces:

```tsx
export function GeoMosaic(props: {
  webcams: WindyWebcam[];
  width: number;
  height: number;
  feed: 'sunrise' | 'sunset';
  setupMode?: boolean;                       // ?setup=1
  onSelect?: (webcam: WindyWebcam) => void;
  config?: Partial<CompositionConfig>;
}): JSX.Element;
```

  `useLoadedTiles(webcams)`: loads each `webcam.images?.current?.preview` via `new Image()`, resolves to `{ tiles: TileInput[], byId: Map<number, {img, webcam}> }`; failed loads are skipped (spec: no black boxes). `GeoMosaic` calls `compose(tiles, {width,height}, merged config)`, draws every placed tile with `ctx.drawImage` on a dpr-scaled canvas (reuse the dpr pattern from MosaicCanvas lines 163–177), keeps hit-rects for `onSelect` clicks. `SetupOverlay` (rendered when `setupMode`): absolutely-positioned DOM `<div>`s — per-tile `lat.toFixed(1)°, lng.toFixed(1)°` caption at tile bottom, big feed label (SUNRISE/SUNSET) bottom-center, ⇧ THIS-WAY-UP arrow top-center, and `n tiles · m dropped · k skipped` counter top-left.

- [ ] **Step 1: Failing tests** (mock `Image` to auto-fire `onload` with 712×400 naturals — jsdom pattern:

```ts
class FakeImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  naturalWidth = 712; naturalHeight = 400;
  set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}
vi.stubGlobal('Image', FakeImage);
```

  ): renders a `<canvas>`; with `setupMode` shows text `SUNSET` and the tile/dropped counter; without it, no overlay text; `onSelect` fires with the webcam when clicking inside a placed tile's rect (drive via `compose` on the same inputs to find a coordinate).
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: Commit** — `feat(geo-mosaic): canvas renderer + setup overlay`

---

### Task 9: swap kiosk pages to GeoMosaic

**Files:**
- Modify: `app/kiosk/sunrise/page.tsx`, `app/kiosk/sunset/page.tsx`
- Test: update `app/kiosk/sunrise/page.test.tsx`, `app/kiosk/sunset/page.test.tsx`

**Interfaces:**
- Consumes: `GeoMosaic` (Task 8). Keep `useKioskRuntime`/`KioskDozeOverlay` wiring untouched.

- [ ] **Step 1:** Update each page test: assert `GeoMosaic` is rendered (mock it, assert props `feed='sunrise'|'sunset'`, full-window width/height) and that `?setup=1` (mock `useSearchParams` from `next/navigation`) passes `setupMode: true`. Run → FAIL.
- [ ] **Step 2:** Replace `<MosaicCanvas …/>` with `<GeoMosaic webcams={webcams} width={dimensions.width} height={dimensions.height} feed="sunrise" setupMode={searchParams.get('setup') === '1'} />` (wrap component usage of `useSearchParams` in the page — App Router client page, add `Suspense` boundary if the build demands it). Remove now-unused `KIOSK_*` mosaic imports from the pages (constants stay in masterConfig for the map… no — kiosk sizing now comes from `COMPOSITION_CONFIG`; leave the old KIOSK mosaic constants in place until Task 11 cleanup).
- [ ] **Step 3:** tests PASS. **Step 4:** `npx tsc --noEmit` clean. **Step 5: Commit** — `feat(geo-mosaic): kiosk pages render GeoMosaic with ?setup=1 mode`

---

### Task 10: swap main-page mosaic modes

**Files:**
- Modify: `app/components/MainViewContainer.tsx:108-176` (both `sunset-mosaic` and `sunrise-mosaic` cases)
- Test: `app/components/MainViewContainer.mosaic.test.tsx` (create)

**Interfaces:**
- Consumes: `GeoMosaic`.

- [ ] **Step 1:** New test mocking `GeoMosaic`: rendering MainViewContainer in `sunset-mosaic` mode passes `feed="sunset"` and container dimensions; same for sunrise. Run → FAIL.
- [ ] **Step 2:** Replace both `<MosaicCanvas …/>` usages with `<GeoMosaic webcams={…} width={…} height={…} feed="sunset"|"sunrise" onSelect={(w) => console.log('Selected webcam:', w.webcamId, w.title)} />`. Keep the existing `sunset-mosaic`/`sunrise-mosaic` case structure and refs. Setup mode on the main page: read `?setup=1` the same way and pass through.
- [ ] **Step 3:** PASS + `tsc` clean. **Step 4: Commit** — `feat(geo-mosaic): main-page mosaic modes use GeoMosaic`

---

### Task 11: delete MosaicCanvas + dead config

**Files:**
- Delete: `app/components/MosaicCanvas/` (whole directory)
- Modify: `app/lib/masterConfig.ts` (remove `KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX`, `KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX`, `KIOSK_CANVAS_MAX_IMAGES`, `MOSAIC_*` size constants IF no remaining importer)
- Modify: `app/lib/masterConfig.test.ts` (drop tests of removed constants)

- [ ] **Step 1:** `grep -rn "MosaicCanvas\|KIOSK_MOSAIC\|KIOSK_CANVAS_MAX\|MOSAIC_MAX_IMAGE\|MOSAIC_MIN_IMAGE\|MOSAIC_SIZE_SCALE" app --include="*.ts*" | grep -v ".claude"` — confirm the only hits are the files being deleted/cleaned. Any unexpected importer → leave that constant, note it in the commit body.
- [ ] **Step 2:** Delete directory, prune constants + their tests.
- [ ] **Step 3:** Full suite `env -u NODE_OPTIONS npx vitest run --exclude "**/.claude/**"` green + `tsc --noEmit` clean + `npm run build` succeeds (catches Next-specific issues like the Suspense/useSearchParams rule).
- [ ] **Step 4: Commit** — `refactor(geo-mosaic): retire MosaicCanvas and dead mosaic config`

---

### Task 12: PR + preview verification

- [ ] **Step 1:** Push branch; `gh pr create` (use `/opt/homebrew/bin/gh`) titled "feat: geographic mosaic composition engine (GeoMosaic) — replaces MosaicCanvas". Body: spec link, what changed, test counts, and a "How to review on the wall" section.
- [ ] **Step 2:** Wait for the Vercel PR preview deployment (gh pr checks / deployment status), grab the preview URL.
- [ ] **Step 3:** Verify `GET <preview>/kiosk/sunset?setup=1` and `/kiosk/sunrise?setup=1` return 200.
- [ ] **Step 4:** Point the kiosk Pi's launcher at the preview URLs (edit `~/kiosk-launch.sh` URL_A/URL_B via ssh, restart chromium) so the wall runs the preview overnight. Do NOT merge the PR — Jesse merges after morning review, then the launcher goes back to production URLs.
