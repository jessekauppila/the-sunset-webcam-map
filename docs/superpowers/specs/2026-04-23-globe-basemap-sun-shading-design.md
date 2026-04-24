# Globe basemap with sun-synced shading

## Goal

Replace the self-drawn deck.gl globe (sphere mesh + land outline + `LightingEffect`) with a real Mapbox globe basemap that keeps country and place labels readable everywhere, while overlaying a sun-synced day/night shadow that stays visually dramatic without obscuring the labels.

Preserve the existing terminator reference layers (terminator line, offset ring, search-radius circles, red query-point dots) in both modes, toggled via the same flags used today.

## Motivation

Today's globe view (`app/components/Map/GlobeMap.tsx`) uses deck.gl's `LightingEffect` + `_SunLight` to shade a self-drawn sphere. The lighting effect is visually great — it gives a clear terminator that makes it instantly obvious *why* the app is surfacing those webcams right now — but the basemap has no country names, no place names, no geography labels.

The 2D map mode (`SimpleMap`, Mapbox dark style) has the opposite problem: rich labels, zero sun-based shading.

The target: one globe view that has both. Labels legible on both hemispheres, middle-dramatic shadow, and the terminator-reference toggles intact.

## Non-goals

- 2D map mode gaining its own sun shading (mercator math is different; separate spec if wanted).
- City-lights night glow on the dark side.
- Webcam filtering changes (the "why are webcams showing everywhere when there's no shadow" question is orthogonal to this spec).
- Building a new UI toggle for the terminator reference layers; preserve whatever toggle pattern exists today.

## Background on why the current setup blocks this

deck.gl's `LightingEffect` shades geometry rendered by deck.gl layers only. Mapbox renders its own raster/vector tiles in its own WebGL context. When deck.gl is overlaid on Mapbox, the lighting shader never sees the basemap pixels — they are composited separately. That is why every attempt to "just put the lighting effect on the Mapbox map" fails.

The fix is to **paint our own shadow** as a custom fragment-shader layer, inserted into the Mapbox style at a slot *below* the label symbol layers. This way the shading tints terrain and water but labels render on top unaffected.

## Approach (chosen: Approach A from brainstorm)

Replace the standalone `<DeckGL>` wrapper in globe mode with a Mapbox instance using `projection: 'globe'`. Add one new custom Mapbox layer (`SunShadowLayer`) that draws a per-pixel day/night mask. Move the existing webcam `IconLayer` onto a `MapboxOverlay` with `interleaved: true`.

The two alternatives considered and rejected:

- **Pure Mapbox `CustomLayerInterface` for everything** — removes deck.gl's shader plumbing for the shadow but still requires `MapboxOverlay` for webcam icons. Net result: more raw WebGL boilerplate, no real dependency reduction. Rejected.
- **`BitmapLayer` with a pre-baked shadow PNG** (Felix's first suggestion) — simplest mentally, but fixed-resolution texture looks blocky at high zoom near the terminator. Fails the "middle-dramatic" quality bar. Rejected.

## Layer stack on the globe (bottom to top)

1. Mapbox style: background, water, terrain fills
2. Mapbox style: country borders and low-zoom labels
3. **NEW — `SunShadowLayer`** inserted with `beforeId` = first symbol layer in the style
4. Mapbox style: symbol layers — country names, place names, city labels
5. **EXISTING — terminator line + offset ring** (native Mapbox `line` layers, added by `useUpdateTerminatorRing`)
6. **EXISTING — search radius circles** (fill + outline)
7. **EXISTING — terminator query-point dots** (`circle` layer)
8. **NEW placement — webcam `IconLayer`** via `MapboxOverlay({ interleaved: true })`

Items 3 and 8 are the only new visual elements. Everything else is either preserved (items 5–7) or moved to a different host (item 8 — same layer, now on `MapboxOverlay` instead of standalone `<DeckGL>`).

## Toggle behavior

- **Sun shadow (`SunShadowLayer`):** always on in globe mode. No toggle.
- **Terminator reference layers:** toggled by the existing flags passed into `useUpdateTerminatorRing` (`attachToMap`, `showSearchRadius`). `SimpleMap.tsx` calls the hook once; that one call drives both modes. Default-off behavior in globe mode is preserved — the hook's options are the only control.

Net user-visible change to toggles: none. Flipping the existing flag affects both 2D and globe modes uniformly.

## Files and components

```
app/components/Map/
  GlobeMap.tsx              # Rewritten as a side-effects-only component
                            #   (~100 lines, down from 259). Accepts the shared
                            #   Mapbox map instance as a prop — does NOT create its
                            #   own map or its own DeckGL canvas.
                            #   Removes: standalone <DeckGL>, SimpleMeshLayer sphere,
                            #   land GeoJsonLayer, LightingEffect/AmbientLight/_SunLight,
                            #   internal viewState management (Mapbox handles camera).
                            #   Adds: useEffect that installs the SunShadowLayer below
                            #   the first Mapbox symbol layer; a MapboxOverlay hosting
                            #   the existing IconLayer for webcams; fly-to handling
                            #   now driven through Mapbox's flyTo() instead of deck.gl
                            #   FlyToInterpolator.
  layers/
    SunShadowLayer.ts       # NEW (~80 lines). Implements Mapbox CustomLayerInterface.
                            #   Renders a full-screen quad with a fragment shader that
                            #   per-pixel: ray-casts screen → globe surface lat/lng,
                            #   builds a surface normal, dots with the sun unit vector,
                            #   smoothsteps the result, writes a deep-blue shadow alpha.
  hooks/
    useMap.ts               # Signature change. Today: useMap(userLocation, enabled).
                            #   After: useMap(userLocation, enabled, options?) where
                            #   options = { projection?: 'globe' | 'mercator' }.
                            #   When omitted, projection defaults to 'mercator'
                            #   (preserving current 2D behavior).
  SimpleMap.tsx             # Changes:
                            #   1. Call useMap(userLocation, true, {
                            #        projection: mode === 'globe' ? 'globe' : 'mercator'
                            #      }) so a single Mapbox map instance exists for both
                            #      modes (today the hook only builds a map when
                            #      mode === 'map').
                            #   2. Change attachToMap: mode === 'map' → attachToMap: true
                            #      in the useUpdateTerminatorRing call. One hook call
                            #      drives both modes; toggle flags unchanged.
                            #   3. Render <div ref={mapContainer}> for both modes. The
                            #      JSX split disappears — Mapbox handles globe vs.
                            #      mercator internally via the projection option.
                            #   4. In globe mode, render <GlobeMap map={map}
                            #      currentTime={...} webcams={...} /> as a
                            #      side-effects-only child that installs the
                            #      SunShadowLayer and the MapboxOverlay-hosted
                            #      IconLayer onto the shared map instance.
  lib/
    subsolarLocation.ts     # UNCHANGED. Already provides subsolarPoint().
    terminatorRing.ts       # UNCHANGED.
    terminatorRingHiRes.ts  # UNCHANGED.
    searchRadiusCircles.ts  # UNCHANGED.
    webcamPopup.tsx         # UNCHANGED.
  hooks/useUpdateTerminatorRing.ts  # UNCHANGED — internals already use native
                                    #   Mapbox layers so it "just works" on the
                                    #   new Mapbox globe.
```

## SunShadowLayer details

### Geometry

A single full-screen quad (two triangles in clip space). Not globe-shaped geometry — the work happens per-fragment.

### Vertex shader

Trivial: passes clip-space position through and forwards screen-space UV to the fragment shader.

### Fragment shader

Per-pixel algorithm:

1. From the fragment's NDC position and Mapbox's `u_matrix`/`projectionMatrix`, ray-cast screen → globe surface. Mapbox provides the matrices needed in its custom layer hooks; pattern off the official `threebox`-style example.
2. Convert the hit point to `(lng, lat)` and then to a unit normal vector in the same frame as the sun vector.
3. Compute `dotP = dot(surfaceNormal, sunDir)`.
4. Map `dotP` to darkness:

```glsl
float daylight = smoothstep(-u_softness, u_softness, dotP);
float darkness = (1.0 - daylight);
gl_FragColor = vec4(u_tint, darkness * u_maxDarkness);
```

5. If the ray misses the globe (pixel is in the space around the sphere), write `vec4(0.0)` so the pixel is untouched.

### Uniforms

| Uniform | Type | Starting value | Purpose |
|---|---|---|---|
| `u_sunDir` | `vec3` | computed per frame | Unit vector from subsolar point |
| `u_inverseViewProjection` | `mat4` | derived per frame from the matrix Mapbox passes into `render(gl, matrix)` | Used to un-project screen coords back to world space |
| `u_softness` | `float` | `0.15` | Terminator gradient width (≈ 8° of sun altitude) |
| `u_maxDarkness` | `float` | `0.65` | Peak alpha on the night side |
| `u_tint` | `vec3` | `(0.05, 0.08, 0.18)` | Deep cool blue shadow color |

The three style uniforms (`u_softness`, `u_maxDarkness`, `u_tint`) are exposed as optional props on `GlobeMap` with the values above as defaults. No UI — tune in source the same way opacities are tuned today.

### Sun vector (CPU side)

```ts
import { subsolarPoint } from './lib/subsolarLocation';

function latLngToUnitVector(latDeg: number, lngDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
}

const { lat, lng } = subsolarPoint(currentTime);
const sunVec = latLngToUnitVector(lat, lng);
// pass sunVec as the u_sunDir uniform on the layer
```

Recomputed only when `currentTime` changes. Existing `SimpleMap.tsx` updates `currentTime` once per minute — no new interval needed.

### Insertion point

On `style.load`, find the first symbol layer and insert the shadow below it:

```ts
map.once('style.load', () => {
  const firstSymbolId = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  map.addLayer(sunShadowLayer, firstSymbolId);
});
```

Robust to Mapbox renaming the canonical "first label" layer id in future style versions.

## Data flow

```
SimpleMap.currentTime (state, tick-per-minute)
  → subsolarPoint(date)                [existing helper]
  → latLngToUnitVector(lat, lng)       [new helper, inline]
  → SunShadowLayer.sunDir uniform
  → Mapbox repaint
  → fragment shader writes shadow alpha under labels
```

Webcam data path is unchanged: `useTerminatorStore().combined` → `IconLayer` data prop → now rendered via `MapboxOverlay` instead of standalone `<DeckGL>`.

## Style choice

`mapbox://styles/mapbox/dark-v11`. First-party Mapbox style, clear symbol layer hierarchy, readable labels on dark background. Mapbox atmosphere/fog stays off — we don't want it competing with the shadow's visual language.

## Edge cases

- **Missing or invalid token** — handled today by `useMap` for 2D mode; globe mode now shares the same path.
- **Style not loaded before layer add** — gated by `map.once('style.load', …)`.
- **Polar regions during solstice** — the dot-product math is well-defined at the poles; no special case.
- **International date line** — fragment math works in 3D unit vectors, so no wraparound concerns.
- **`currentTime` cadence** — 60 s updates mean the terminator jumps ~0.25° per tick. Imperceptible, no interpolation needed.
- **Mode switch (globe ↔ 2D)** — today `GlobeMap` is conditionally rendered in `SimpleMap.tsx`; unmount tears down the Mapbox instance, Mapbox disposes layers and sources.

## Testing

Visual change, so passing tests alone do not mean the feature works.

1. **Unit test** — sun-vector math. Given a known `(date, expected subsolar lat/lng)`, confirm the unit vector matches. Pattern off `app/components/Map/lib/subsolarLocation.test.ts`.
2. **Type-check and existing test suite** — `npm run lint && npm test`, no regressions.
3. **Manual visual verification (required):**
   - Globe view: country and place labels readable over both day and night hemispheres.
   - Shadow visible and middle-dramatic — not a faint veil, not label-obscuring.
   - Advance `currentTime` ~6 hours (temporary dev affordance or just wait) — terminator rotates.
   - Toggle terminator rings / search radius on — rings render above the shadow, interactive as before.
   - Switch to 2D map mode — no regression.
4. **Screenshots** of both globe modes (shadow on, rings on top of shadow) attached to the PR.

## Performance

One extra draw call per frame. Full-screen quad, short fragment shader, no texture reads. Well under 1 ms on integrated GPUs.

## Open questions / deferred

- **Exact starting values of `u_softness`, `u_maxDarkness`, `u_tint`** — committed defaults above are a reasonable starting point; plan on one tuning pass after first live render.
- **Mapbox `fog`/`atmosphere` on globe** — left off for now. Could be added later as an orthogonal visual enhancement; not needed for the primary goal.
