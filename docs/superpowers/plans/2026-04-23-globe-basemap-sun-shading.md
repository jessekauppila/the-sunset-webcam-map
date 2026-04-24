# Globe basemap with sun-synced shading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the self-drawn deck.gl globe with a Mapbox globe basemap (labels readable) and overlay a sun-synced day/night shadow rendered as a Mapbox custom layer below the label symbols.

**Architecture:** One shared Mapbox instance for both 2D and globe modes (via `projection: 'globe' | 'mercator'`). A new `SunShadowLayer` implements `CustomLayerInterface` with a full-screen-quad fragment shader that computes per-pixel sun-vs-surface shading. The existing webcam `IconLayer` migrates from standalone `<DeckGL>` onto `MapboxOverlay({ interleaved: true })`. Terminator reference layers (already native Mapbox via `useUpdateTerminatorRing`) are preserved with their existing toggle flags.

**Tech Stack:** Next.js 15, React 19, TypeScript, Mapbox GL JS 3.14, deck.gl 9.1 (`@deck.gl/mapbox` added), Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-04-23-globe-basemap-sun-shading-design.md`

---

## File structure (what gets touched)

| File | Status | Responsibility |
|---|---|---|
| `app/components/Map/lib/latLngToUnitVector.ts` | **new** | Pure function `latLngToUnitVector(latDeg, lngDeg) → [x, y, z]` (~10 lines). |
| `app/components/Map/lib/latLngToUnitVector.test.ts` | **new** | Vitest unit tests for the helper. |
| `app/components/Map/layers/SunShadowLayer.ts` | **new** | Mapbox `CustomLayerInterface` implementation. Owns the WebGL program, quad geometry, uniforms, and per-frame `setSunDirection()`. |
| `app/components/Map/hooks/useMap.ts` | rewritten | Accepts `options.projection`. Dead `setLight`/`calculateSunPosition` code removed. Returns the same shape as before. |
| `app/components/Map/GlobeMap.tsx` | rewritten | Side-effects-only: accepts the shared map, installs `SunShadowLayer` below first symbol, installs `MapboxOverlay` with webcam `IconLayer`, drives fly-to via `map.flyTo()`. |
| `app/components/Map/SimpleMap.tsx` | modified | One shared `useMap` call driving both modes; unified `<div ref={mapContainer}>`; `attachToMap: true` in `useUpdateTerminatorRing`. |
| `package.json` / `package-lock.json` | modified | Adds `@deck.gl/mapbox`. |

Unchanged: `subsolarLocation.ts`, `terminatorRing.ts`, `terminatorRingHiRes.ts`, `searchRadiusCircles.ts`, `webcamPopup.tsx`, `useUpdateTerminatorRing.ts`.

**Intermediate states are visually broken on purpose.** After Tasks 4–6, globe mode renders Mapbox with webcams but no shadow (SunShadowLayer is a no-op). Task 7 turns on the shading. This is a conscious trade for cleaner commits.

---

## Task 1: Add `@deck.gl/mapbox` dependency

**Why:** `MapboxOverlay` (needed to host the webcam `IconLayer` on the Mapbox map) lives in this package. Pinning to the same 9.1.x minor as the rest of deck.gl.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-updated by npm)

- [ ] **Step 1: Install**

```bash
cd /Users/jessekauppila/Documents/GitHub/the-sunset-webcam-map
npm install @deck.gl/mapbox@^9.1.14
```

Expected: installs without peer-dep warnings; `package.json` gets a new line under `dependencies` for `"@deck.gl/mapbox"`.

- [ ] **Step 2: Verify import resolves**

```bash
node -e "console.log(require.resolve('@deck.gl/mapbox'))"
```

Expected: prints a path under `node_modules/@deck.gl/mapbox/`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @deck.gl/mapbox for MapboxOverlay"
```

---

## Task 2: Add `latLngToUnitVector` helper (TDD)

**Why:** Both the CPU-side sun vector and the shader's surface normal computation need to share the same lat/lng → Cartesian convention. Extracting it to a tested helper prevents silent frame-mismatch bugs.

**Convention:** X = east at (0°, 0°), Y = north pole, Z = out of page at (0°, 90°E). In code:

```
x = cos(lat) * cos(lng)
y = sin(lat)
z = cos(lat) * sin(lng)
```

**Files:**
- Create: `app/components/Map/lib/latLngToUnitVector.ts`
- Create: `app/components/Map/lib/latLngToUnitVector.test.ts`

- [ ] **Step 1: Write the failing test**

Write `app/components/Map/lib/latLngToUnitVector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { latLngToUnitVector } from './latLngToUnitVector';

describe('latLngToUnitVector', () => {
  it('(0, 0) → (1, 0, 0)', () => {
    const [x, y, z] = latLngToUnitVector(0, 0);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('north pole (90, 0) → (0, 1, 0)', () => {
    const [x, y, z] = latLngToUnitVector(90, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('(0, 90) → (0, 0, 1)', () => {
    const [x, y, z] = latLngToUnitVector(0, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('(0, 180) → (-1, 0, 0)', () => {
    const [x, y, z] = latLngToUnitVector(0, 180);
    expect(x).toBeCloseTo(-1, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('returns a unit vector for arbitrary inputs', () => {
    const [x, y, z] = latLngToUnitVector(37.5, -122.25);
    const length = Math.sqrt(x * x + y * y + z * z);
    expect(length).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/components/Map/lib/latLngToUnitVector.test.ts
```

Expected: FAIL — `Cannot find module './latLngToUnitVector'`.

- [ ] **Step 3: Write the implementation**

Write `app/components/Map/lib/latLngToUnitVector.ts`:

```ts
export function latLngToUnitVector(
  latDeg: number,
  lngDeg: number,
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const x = Math.cos(lat) * Math.cos(lng);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.sin(lng);
  return [x, y, z];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run app/components/Map/lib/latLngToUnitVector.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/Map/lib/latLngToUnitVector.ts \
        app/components/Map/lib/latLngToUnitVector.test.ts
git commit -m "Add latLngToUnitVector helper with unit tests"
```

---

## Task 3: Scaffold `SunShadowLayer` as a no-op custom layer

**Why:** Establish the class shape, interface compliance, and typing before adding shader complexity. After this task, the layer can be instantiated and added to a map without crashing — but renders nothing.

**Files:**
- Create: `app/components/Map/layers/SunShadowLayer.ts`

- [ ] **Step 1: Write the no-op scaffold**

Write `app/components/Map/layers/SunShadowLayer.ts`:

```ts
import type { CustomLayerInterface, Map as MapboxMap } from 'mapbox-gl';

export interface SunShadowLayerOptions {
  id?: string;
  softness?: number;
  maxDarkness?: number;
  tint?: [number, number, number];
}

/**
 * Mapbox custom layer that renders a sun-synced day/night shadow on the globe.
 * No-op scaffold — shader is wired up in a later task.
 */
export class SunShadowLayer implements CustomLayerInterface {
  public readonly id: string;
  public readonly type = 'custom' as const;
  public readonly renderingMode = '3d' as const;

  private sunDir: [number, number, number] = [1, 0, 0];
  private softness: number;
  private maxDarkness: number;
  private tint: [number, number, number];

  private map: MapboxMap | null = null;

  constructor(options: SunShadowLayerOptions = {}) {
    this.id = options.id ?? 'sun-shadow';
    this.softness = options.softness ?? 0.15;
    this.maxDarkness = options.maxDarkness ?? 0.65;
    this.tint = options.tint ?? [0.05, 0.08, 0.18];
  }

  setSunDirection(dir: [number, number, number]): void {
    this.sunDir = dir;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapboxMap, _gl: WebGL2RenderingContext): void {
    this.map = map;
    // Shader program setup will go here in Task 7.
  }

  onRemove(_map: MapboxMap, _gl: WebGL2RenderingContext): void {
    this.map = null;
    // Program/buffer cleanup will go here in Task 7.
  }

  render(_gl: WebGL2RenderingContext, _matrix: number[]): void {
    // No-op. Shader rendering wired up in Task 7.
    // Reference fields so TS doesn't warn while this is a scaffold.
    void this.sunDir;
    void this.softness;
    void this.maxDarkness;
    void this.tint;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add app/components/Map/layers/SunShadowLayer.ts
git commit -m "Scaffold SunShadowLayer as no-op custom layer"
```

---

## Task 4: Update `useMap` to accept a `projection` option; remove dead lighting code

**Why:** The globe mode needs a Mapbox instance too, and `projection` is the one init option that differs between modes. The existing `setLight`/`calculateSunPosition` code at `useMap.ts:26-39, 101, 109` tries to drive Mapbox's native light API but that only affects 3D extruded buildings, not basemap tiles — it's ineffective and misleading to future readers. Deleted as part of this rewrite.

**Files:**
- Modify: `app/components/Map/hooks/useMap.ts`

- [ ] **Step 1: Replace `useMap` contents**

Replace the full contents of `app/components/Map/hooks/useMap.ts` with:

```ts
import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../../lib/types';
import mapboxgl from 'mapbox-gl';

export interface UseMapOptions {
  projection?: 'globe' | 'mercator';
}

export function useMap(
  userLocation: Location,
  enabled: boolean = true,
  options: UseMapOptions = {},
) {
  const projection = options.projection ?? 'mercator';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const initialCenterRef = useRef<[number, number]>([
    userLocation.lng,
    userLocation.lat,
  ]);

  // Set Mapbox token once
  mapboxgl.accessToken =
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

  useEffect(() => {
    if (!enabled) {
      if (map.current) {
        console.log('🧹 Cleaning up map (disabled)...');
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
        setMapReady(false);
      }
      return;
    }

    if (!mapContainer.current || map.current) return;

    if (!mapboxgl.accessToken) {
      console.error('❌ No Mapbox access token found!');
      return;
    }

    console.log(`🚀 Initializing map (projection=${projection})...`);

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCenterRef.current,
      zoom: projection === 'globe' ? 0 : 6,
      projection: { name: projection },
    });

    map.current.on('load', () => {
      console.log('✅ Map loaded successfully!');
      setMapLoaded(true);
    });

    map.current.on('style.load', () => {
      console.log('✅ Map style loaded!');
      setMapReady(true);
    });

    map.current.on('error', (e) => {
      console.error('🚨 Map error:', e);
    });

    return () => {
      if (map.current) {
        console.log('🧹 Cleaning up map...');
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
        setMapReady(false);
      }
    };
  }, [enabled, projection]);

  return {
    mapContainer,
    map: map.current || null,
    mapLoaded,
    mapReady,
    hasToken: !!mapboxgl.accessToken,
  };
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npm run lint
```

Expected: no new errors in `useMap.ts`. If any existing callers pass a second arg, they continue to work because the third arg defaults to `{}`.

- [ ] **Step 3: Commit**

```bash
git add app/components/Map/hooks/useMap.ts
git commit -m "Add projection option to useMap; remove dead setLight code"
```

---

## Task 5: Refactor `GlobeMap.tsx` to a side-effects-only component

**Why:** The new architecture has one shared Mapbox map (owned by `useMap` in `SimpleMap`). `GlobeMap` now takes that map as a prop and side-effects layers onto it — no more DeckGL wrapper, no more viewState management, no more internal sphere geometry.

**Note:** After this task, globe mode will technically be broken (SimpleMap still passes old props and expects the old component). Task 6 fixes that. Intermediate state is expected.

**Files:**
- Modify: `app/components/Map/GlobeMap.tsx` (full rewrite)

- [ ] **Step 1: Replace `GlobeMap.tsx` contents**

Replace the full contents of `app/components/Map/GlobeMap.tsx` with:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer } from '@deck.gl/layers';
import { subsolarPoint } from './lib/subsolarLocation';
import { latLngToUnitVector } from './lib/latLngToUnitVector';
import { SunShadowLayer } from './layers/SunShadowLayer';
import type { WindyWebcam } from '../../lib/types';
import { createWebcamPopupContent } from './lib/webcamPopup';

interface GlobeMapProps {
  map: MapboxMap | null;
  mapLoaded: boolean;
  webcams: WindyWebcam[];
  currentTime: Date;
  targetLocation?: { longitude: number; latitude: number } | null;
  isPaused?: boolean;
}

export default function GlobeMap({
  map,
  mapLoaded,
  webcams,
  currentTime,
  targetLocation = null,
  isPaused = false,
}: GlobeMapProps) {
  const shadowLayerRef = useRef<SunShadowLayer | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  // Install SunShadowLayer below the first Mapbox symbol layer.
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const install = () => {
      if (shadowLayerRef.current) return;
      const layer = new SunShadowLayer();
      const firstSymbolId = map
        .getStyle()
        ?.layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer(layer, firstSymbolId);
      shadowLayerRef.current = layer;
    };

    if (map.isStyleLoaded()) {
      install();
    } else {
      map.once('style.load', install);
    }

    return () => {
      if (shadowLayerRef.current && map.getLayer(shadowLayerRef.current.id)) {
        map.removeLayer(shadowLayerRef.current.id);
      }
      shadowLayerRef.current = null;
    };
  }, [map, mapLoaded]);

  // Push the sun direction into the shadow layer whenever currentTime changes.
  useEffect(() => {
    if (!shadowLayerRef.current) return;
    const { lat, lng } = subsolarPoint(currentTime);
    shadowLayerRef.current.setSunDirection(latLngToUnitVector(lat, lng));
  }, [currentTime, mapLoaded]);

  // Filter webcams (same 3D culling logic as before, adapted for shared map camera).
  const filteredWebcams = useMemo(
    () =>
      (webcams || []).filter((webcam) => {
        if (!webcam || !webcam.location || !webcam.webcamId) return false;
        if (!map) return true;
        const cam = map.getCenter();
        const lat1 = (cam.lat * Math.PI) / 180;
        const lng1 = (cam.lng * Math.PI) / 180;
        const lat2 = (webcam.location.latitude * Math.PI) / 180;
        const lng2 = (webcam.location.longitude * Math.PI) / 180;
        const dLat = lat2 - lat1;
        const dLng = lng2 - lng1;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        const angularDistance =
          2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (180 / Math.PI);
        return angularDistance < 100;
      }),
    [webcams, map],
  );

  // Install the MapboxOverlay (hosts the IconLayer for webcams).
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay);
    overlayRef.current = overlay;

    return () => {
      map.removeControl(overlay);
      overlayRef.current = null;
    };
  }, [map, mapLoaded]);

  // Update the overlay's layers whenever webcam data changes.
  useEffect(() => {
    if (!overlayRef.current) return;

    const iconLayer = new IconLayer<WindyWebcam>({
      id: 'webcams',
      data: filteredWebcams,
      getIcon: (w) => {
        const fallback =
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" ry="8" fill="%23eee"/><text x="8" y="36" font-size="24">🌅</text></svg>';
        const previewUrl = w.images?.current?.preview;
        const isValidUrl =
          previewUrl &&
          (previewUrl.startsWith('http://') ||
            previewUrl.startsWith('https://')) &&
          previewUrl.length > 10;
        const url = isValidUrl ? previewUrl : fallback;
        if (isValidUrl) {
          return { url, width: 64, height: 36, anchorY: 40 };
        }
        return { url, width: 48, height: 48, anchorY: 24 };
      },
      sizeUnits: 'pixels',
      getSize: 48,
      getPosition: (w) => [
        w?.location?.longitude || 0,
        w?.location?.latitude || 0,
        50000,
      ],
      loadOptions: { image: { crossOrigin: 'anonymous' } },
      onError: (error) => {
        console.warn('Failed to load webcam icon:', error);
      },
      pickable: true,
      billboard: true,
      parameters: { depthTest: false } as Record<string, unknown>,
      onHover: ({ object, x, y }) => {
        if (!map) return;
        const canvas = map.getCanvasContainer();
        if (!object) {
          canvas.title = '';
          return;
        }
        canvas.title = createWebcamPopupContent(object as WindyWebcam);
        void x;
        void y;
      },
    });

    overlayRef.current.setProps({ layers: [iconLayer] });
  }, [filteredWebcams, map]);

  // Fly to targetLocation via Mapbox's flyTo.
  const previousLocationRef = useRef<{
    longitude: number;
    latitude: number;
  } | null>(null);

  useEffect(() => {
    if (!map || !mapLoaded || !targetLocation || isPaused) return;
    const prev = previousLocationRef.current;
    const changed =
      !prev ||
      prev.longitude !== targetLocation.longitude ||
      prev.latitude !== targetLocation.latitude;
    if (!changed) return;
    previousLocationRef.current = targetLocation;
    map.flyTo({
      center: [targetLocation.longitude, targetLocation.latitude],
      zoom: Math.max(map.getZoom(), 0.8),
      duration: 2000,
    });
  }, [map, mapLoaded, targetLocation, isPaused]);

  return null;
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npm run lint
```

Expected: TypeScript errors on `SimpleMap.tsx` where it still calls `<GlobeMap webcams={...} sunrise={...} sunset={...} initialViewState={...} mode={...} />` with old props. **That's expected** and gets fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add app/components/Map/GlobeMap.tsx
git commit -m "Refactor GlobeMap to side-effects-only component"
```

---

## Task 6: Update `SimpleMap.tsx` to use one shared Mapbox map for both modes

**Why:** Finishes the architecture shift. One `useMap` call drives both modes; the JSX no longer branches on `mode` for the container; `useUpdateTerminatorRing` attaches to the shared map in both modes (its existing toggle flags still control visibility).

**Files:**
- Modify: `app/components/Map/SimpleMap.tsx`

- [ ] **Step 1: Update `useMap` call**

In `app/components/Map/SimpleMap.tsx`, replace the `useMap` call (currently lines 38-41):

```tsx
const { mapContainer, map, mapLoaded, mapReady } = useMap(
  userLocation,
  mode === 'map',
);
```

with:

```tsx
const { mapContainer, map, mapLoaded, mapReady } = useMap(
  userLocation,
  true,
  { projection: mode === 'globe' ? 'globe' : 'mercator' },
);
```

- [ ] **Step 2: Update `useUpdateTerminatorRing` call**

Still in `SimpleMap.tsx`, change `attachToMap: mode === 'map'` to `attachToMap: true` in the `useUpdateTerminatorRing` call (currently line 60):

```tsx
const { sunrise, sunset } = useUpdateTerminatorRing(
  map,
  mapLoaded,
  currentTime,
  {
    attachToMap: true,
    showSearchRadius: false,
    precisionDeg: TERMINATOR_PRECISION_DEG,
    searchRadiusDegrees: SEARCH_RADIUS_DEG,
  },
);
```

- [ ] **Step 3: Unify the JSX (one shared container)**

Replace the inner JSX (currently the `{mode === 'map' ? ... : ...}` block at lines 141-184) with:

```tsx
<div ref={interactionContainerRef} className="w-full h-full">
  <div
    ref={mapContainer}
    className="w-full h-full"
    style={{ position: 'relative', zIndex: 1 }}
  />
  {mode === 'globe' && (
    <GlobeMap
      map={map}
      mapLoaded={mapLoaded}
      webcams={allTerminatorWebcams || []}
      currentTime={currentTime}
      targetLocation={
        nextLatitudeNorthSunsetLocation
          ? {
              longitude: nextLatitudeNorthSunsetLocation.lng,
              latitude: nextLatitudeNorthSunsetLocation.lat,
            }
          : null
      }
      isPaused={isPaused}
    />
  )}
  {!mapLoaded && (
    <div
      className="absolute inset-0 bg-gray-500 flex items-center justify-center"
      style={{ zIndex: 2 }}
    >
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p>Loading map...</p>
      </div>
    </div>
  )}
</div>
```

Keep the existing `dynamic(() => import('./GlobeMap'), { ssr: false, ... })` wrapper at lines 14-18 unchanged. `GlobeMap` now imports `MapboxOverlay` from `@deck.gl/mapbox`, which transitively pulls in WebGL-dependent deck.gl code — keeping SSR off is the safe default.

- [ ] **Step 4: Type-check and lint**

```bash
npm run lint
```

Expected: no errors. Previous prop-shape errors on `<GlobeMap>` are now resolved.

- [ ] **Step 5: Run existing tests**

```bash
npm test -- --run
```

Expected: all existing tests pass (no test file was modified). If any `SimpleMap.test.tsx` assertions break, they likely asserted on the old mode-branched DOM structure — note them but don't fix in this task; log as a follow-up.

- [ ] **Step 6: Smoke-test in the browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Toggle to globe mode. Expected at this intermediate stage:
- Globe renders with Mapbox labels (country, city names) visible.
- Webcams appear as icons.
- **No sun shading yet** — this is expected; Task 7 adds it.
- Switch to 2D map — no regression.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/components/Map/SimpleMap.tsx
git commit -m "Unify SimpleMap to share one Mapbox map across modes"
```

---

## Task 7: Implement the `SunShadowLayer` shader

**Why:** Turns the no-op layer into the actual day/night shadow. After this task, the feature is functionally complete.

**Files:**
- Modify: `app/components/Map/layers/SunShadowLayer.ts`

**Approach:** The layer renders a single full-screen triangle (covers the whole viewport with one primitive, better than a quad). In the fragment shader:

1. Take the fragment's screen-space UV, back-project through the inverse view-projection matrix to get a world-space ray.
2. Intersect the ray with a unit sphere centered at the origin (Mapbox's globe is unit-radius in its internal coordinate space — see `MercatorCoordinate` docs).
3. If no hit, discard.
4. If hit, the hit point IS the surface normal (unit sphere). Dot with `u_sunDir`, smoothstep, output shadow color.

**Important:** The exact mapping from Mapbox screen coords to the sphere surface is non-trivial because Mapbox's globe is a projected view of lat/lng, not a literal 3D sphere render. The robust approach is to **pass per-vertex lat/lng** by drawing the sphere as a fine mesh of triangles (e.g., 72 × 36 lon/lat grid = ~5000 triangles) rather than a full-screen quad, and let Mapbox's vertex shader project each vertex correctly via the matrix it hands us. Fragment shader then works in lat/lng directly.

This is a small deviation from "full-screen quad + ray-cast" described in the spec. Use a sphere mesh instead — simpler, more robust, negligible perf cost.

- [ ] **Step 1: Replace `SunShadowLayer.ts` with the full implementation**

Replace the contents of `app/components/Map/layers/SunShadowLayer.ts` with:

```ts
import type { CustomLayerInterface, Map as MapboxMap } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';

export interface SunShadowLayerOptions {
  id?: string;
  softness?: number;
  maxDarkness?: number;
  tint?: [number, number, number];
  /** Longitude subdivisions (default 72 → every 5°). */
  lonSubdivisions?: number;
  /** Latitude subdivisions (default 36 → every 5°). */
  latSubdivisions?: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_lngLat;
uniform mat4 u_matrix;
out vec3 v_unitNormal;

void main() {
  float lng = radians(a_lngLat.x);
  float lat = radians(a_lngLat.y);

  // Mapbox's MercatorCoordinate for a (lng, lat) with altitude 0.
  // The projection math: the matrix Mapbox hands us transforms
  // MercatorCoordinate world-space directly to clip space.
  float x = (a_lngLat.x + 180.0) / 360.0;
  float yMerc = 0.5 - log(tan(0.25 * 3.14159265 + 0.5 * lat)) / (2.0 * 3.14159265);
  vec4 worldPos = vec4(x, yMerc, 0.0, 1.0);
  gl_Position = u_matrix * worldPos;

  v_unitNormal = vec3(cos(lat) * cos(lng), sin(lat), cos(lat) * sin(lng));
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_unitNormal;
uniform vec3 u_sunDir;
uniform float u_softness;
uniform float u_maxDarkness;
uniform vec3 u_tint;
out vec4 fragColor;

void main() {
  float dotP = dot(normalize(v_unitNormal), normalize(u_sunDir));
  float daylight = smoothstep(-u_softness, u_softness, dotP);
  float darkness = (1.0 - daylight) * u_maxDarkness;
  fragColor = vec4(u_tint, darkness);
}
`;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`SunShadowLayer shader compile failed: ${info}`);
  }
  return shader;
}

// Latitude is clamped to ±MAX_LAT_DEG to avoid the log(tan(...)) singularity
// at the poles in the mercator Y calculation. Polar caps (last ~5°) will not
// be shaded — acceptable trade-off given labels in that region are also sparse.
const MAX_LAT_DEG = 85;

function buildSphereMesh(
  lonSubs: number,
  latSubs: number,
): Float32Array {
  // Vertex format: vec2(lng, lat). Two triangles per quad.
  const verts: number[] = [];
  const latSpan = 2 * MAX_LAT_DEG;
  for (let j = 0; j < latSubs; j++) {
    const lat0 = -MAX_LAT_DEG + (latSpan * j) / latSubs;
    const lat1 = -MAX_LAT_DEG + (latSpan * (j + 1)) / latSubs;
    for (let i = 0; i < lonSubs; i++) {
      const lng0 = -180 + (360 * i) / lonSubs;
      const lng1 = -180 + (360 * (i + 1)) / lonSubs;
      verts.push(lng0, lat0, lng1, lat0, lng1, lat1);
      verts.push(lng0, lat0, lng1, lat1, lng0, lat1);
    }
  }
  return new Float32Array(verts);
}

export class SunShadowLayer implements CustomLayerInterface {
  public readonly id: string;
  public readonly type = 'custom' as const;
  public readonly renderingMode = '3d' as const;

  private sunDir: [number, number, number] = [1, 0, 0];
  private softness: number;
  private maxDarkness: number;
  private tint: [number, number, number];
  private lonSubs: number;
  private latSubs: number;

  private map: MapboxMap | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private vertexCount = 0;
  private uMatrixLoc: WebGLUniformLocation | null = null;
  private uSunDirLoc: WebGLUniformLocation | null = null;
  private uSoftnessLoc: WebGLUniformLocation | null = null;
  private uMaxDarknessLoc: WebGLUniformLocation | null = null;
  private uTintLoc: WebGLUniformLocation | null = null;

  constructor(options: SunShadowLayerOptions = {}) {
    this.id = options.id ?? 'sun-shadow';
    this.softness = options.softness ?? 0.15;
    this.maxDarkness = options.maxDarkness ?? 0.65;
    this.tint = options.tint ?? [0.05, 0.08, 0.18];
    this.lonSubs = options.lonSubdivisions ?? 72;
    this.latSubs = options.latSubdivisions ?? 36;
  }

  setSunDirection(dir: [number, number, number]): void {
    this.sunDir = dir;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapboxMap, gl: WebGL2RenderingContext): void {
    this.map = map;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `SunShadowLayer program link failed: ${gl.getProgramInfoLog(program)}`,
      );
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = program;
    this.uMatrixLoc = gl.getUniformLocation(program, 'u_matrix');
    this.uSunDirLoc = gl.getUniformLocation(program, 'u_sunDir');
    this.uSoftnessLoc = gl.getUniformLocation(program, 'u_softness');
    this.uMaxDarknessLoc = gl.getUniformLocation(program, 'u_maxDarkness');
    this.uTintLoc = gl.getUniformLocation(program, 'u_tint');

    const mesh = buildSphereMesh(this.lonSubs, this.latSubs);
    this.vertexCount = mesh.length / 2;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    const aLngLat = gl.getAttribLocation(program, 'a_lngLat');
    gl.enableVertexAttribArray(aLngLat);
    gl.vertexAttribPointer(aLngLat, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MapboxMap, gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext, matrix: number[]): void {
    if (!this.program || !this.vao) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uMatrixLoc, false, matrix);
    gl.uniform3fv(this.uSunDirLoc, this.sunDir);
    gl.uniform1f(this.uSoftnessLoc, this.softness);
    gl.uniform1f(this.uMaxDarknessLoc, this.maxDarkness);
    gl.uniform3fv(this.uTintLoc, this.tint);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
}

// Mark unused import so TS doesn't complain in strict modes.
void mapboxgl;
```

- [ ] **Step 2: Type-check and lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Manual visual verification in browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Switch to globe mode. Expected:
- Dramatic-but-not-overwhelming shadow visible on the night side.
- Country and city labels still readable over both hemispheres.
- Terminator follows a soft gradient (not a hard edge).
- Country outlines still legible in the dark zone.

Scrub `currentTime` forward (edit `SimpleMap.tsx:48` interval to 1000ms temporarily, or just wait) — confirm the shadow rotates.

Toggle terminator reference layers on (via `showSearchRadius: true` in `SimpleMap.tsx:62`) — confirm rings render **on top** of the shadow, not below it.

Revert any temporary dev changes.

- [ ] **Step 4: Commit**

```bash
git add app/components/Map/layers/SunShadowLayer.ts
git commit -m "Implement SunShadowLayer shader for day/night shading"
```

---

## Task 8: Final verification and cleanup

**Why:** Sweep for any residual dead code or regressions from the refactor.

- [ ] **Step 1: Search for stale imports**

```bash
grep -rE "SphereGeometry|SimpleMeshLayer|_GlobeView|LightingEffect|_SunLight" /Users/jessekauppila/Documents/GitHub/the-sunset-webcam-map/app 2>&1
```

Expected: no matches. If any remain, remove them.

- [ ] **Step 2: Verify no longer used deck.gl packages**

The deck.gl `_GlobeView` / `mesh-layers` imports came from the old `GlobeMap`. If nothing else in the app uses them, the `@deck.gl/mesh-layers` dep (if present) and `@luma.gl/engine` import can be dropped. Check:

```bash
grep -rE "@deck.gl/mesh-layers|@luma.gl/engine" /Users/jessekauppila/Documents/GitHub/the-sunset-webcam-map/app 2>&1
```

If no matches, leave the packages in `package.json` for now (removing them is a separate, risk-free cleanup PR).

- [ ] **Step 3: Run full test suite + lint**

```bash
npm run lint && npm test -- --run
```

Expected: both pass.

- [ ] **Step 4: Full visual checklist**

```bash
npm run dev
```

Walk through:
- 2D map mode: labels, webcams, terminator toggles work as before.
- Globe mode: labels visible everywhere, sun shadow rotating correctly, terminator toggles work.
- Mode switch both directions multiple times: no console errors, no visual artifacts.
- Check browser console for any WebGL warnings.

- [ ] **Step 5: Commit any cleanup**

If Step 1 or 2 found anything, commit:

```bash
git add -A
git commit -m "Remove stale deck.gl imports from globe refactor"
```

Otherwise, skip.

---

## Done

After Task 8, the feature is complete:
- Mapbox globe basemap with full labels
- Sun-synced shadow always on, rotates with `currentTime`
- Terminator reference layers preserved with their existing toggle flags
- No regressions on 2D map mode

Tune `softness`, `maxDarkness`, `tint` in `GlobeMap.tsx` (pass as options when constructing `SunShadowLayer`) if the default drama level needs adjustment after seeing it live.
