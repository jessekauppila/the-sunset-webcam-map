'use client';

import { useEffect, useMemo } from 'react';
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl';
import useSWR from 'swr';
import { sweepOverlayFeatures, sweepRings, type SweptZone } from '../lib/sweepOverlay';
import { anyRingShown, useSweepOverlayStore } from '@/app/store/useSweepOverlayStore';

interface SweepZoneResponse {
  zone: SweptZone;
  recorded: boolean;
  forcedDayRing: boolean;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`sweep-zone ${r.status}`);
    return r.json() as Promise<SweepZoneResponse>;
  });

const LINES_SOURCE = 'sweep-rings-source';
const LINES_LAYER = 'sweep-rings-layer';
const BOXES_SOURCE = 'sweep-boxes-source';
const BOXES_FILL_LAYER = 'sweep-boxes-fill-layer';
const BOXES_LINE_LAYER = 'sweep-boxes-line-layer';

/** Warm for the base ring, cool for day, deep for night; faint until swept. */
const RING_COLOR: mapboxgl.Expression = [
  'case',
  ['==', ['get', 'offsetDeg'], 0], '#fbbf24',
  ['>', ['get', 'offsetDeg'], 0], '#60a5fa',
  '#a78bfa',
];
const SWEPT_OPACITY: mapboxgl.Expression = ['case', ['get', 'swept'], 0.9, 0.3];
const SWEPT_FILL_OPACITY: mapboxgl.Expression = ['case', ['get', 'swept'], 0.12, 0.04];

/**
 * Draws the sweep on the globe: every ring the cron can query, its Windy
 * boxes on request, and whether each ring ran on the last tick. Nothing is
 * added to the map until a toggle asks for it, so the public globe is
 * untouched by default.
 */
export function useSweepOverlay(map: MapboxMap | null, mapLoaded: boolean, currentTime: Date) {
  const toggles = useSweepOverlayStore();
  // Remembered toggles must draw without the Ops tab being open.
  useEffect(() => { toggles.hydrate(); }, [toggles]);
  const active = anyRingShown(toggles);

  // Poll only while something is drawn; the cron rewrites the zone each tick.
  const { data } = useSWR(active ? '/api/sweep-zone' : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const zone = data?.zone ?? null;

  const features = useMemo(() => {
    if (!active) return null;
    const rings = sweepRings(zone).filter((r) =>
      r.offsetDeg === 0 ? toggles.showBase : r.offsetDeg > 0 ? toggles.showDay : toggles.showNight,
    );
    return sweepOverlayFeatures(currentTime, rings, toggles.showBoxes);
  }, [active, zone, currentTime, toggles.showBase, toggles.showDay, toggles.showNight, toggles.showBoxes]);

  useEffect(() => {
    if (!map || !mapLoaded) return;
    const remove = () => {
      try {
        for (const id of [BOXES_FILL_LAYER, BOXES_LINE_LAYER, LINES_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [BOXES_SOURCE, LINES_SOURCE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        // the map is being disposed
      }
    };
    if (!features) { remove(); return; }
    const apply = () => {
      try {
        const lines = map.getSource(LINES_SOURCE) as GeoJSONSource | undefined;
        if (lines) lines.setData(features.lines);
        else map.addSource(LINES_SOURCE, { type: 'geojson', data: features.lines });
        const boxes = map.getSource(BOXES_SOURCE) as GeoJSONSource | undefined;
        if (boxes) boxes.setData(features.boxes);
        else map.addSource(BOXES_SOURCE, { type: 'geojson', data: features.boxes });

        if (!map.getLayer(BOXES_FILL_LAYER)) {
          map.addLayer({
            id: BOXES_FILL_LAYER, type: 'fill', source: BOXES_SOURCE,
            paint: { 'fill-color': RING_COLOR, 'fill-opacity': SWEPT_FILL_OPACITY },
          });
        }
        if (!map.getLayer(BOXES_LINE_LAYER)) {
          map.addLayer({
            id: BOXES_LINE_LAYER, type: 'line', source: BOXES_SOURCE,
            paint: { 'line-color': RING_COLOR, 'line-width': 1, 'line-opacity': SWEPT_OPACITY },
          });
        }
        if (!map.getLayer(LINES_LAYER)) {
          map.addLayer({
            id: LINES_LAYER, type: 'line', source: LINES_SOURCE,
            paint: { 'line-color': RING_COLOR, 'line-width': 2, 'line-opacity': SWEPT_OPACITY },
          });
        }
      } catch (error) {
        console.warn('[sweepOverlay] layer update failed:', error);
      }
    };
    // addSource throws until the style is in. isStyleLoaded() stays false
    // while tiles are still arriving and style.load has usually fired before
    // this effect subscribes, so wait on idle, which fires once the map has
    // nothing left to load and again after every later change.
    if (map.isStyleLoaded()) apply();
    else map.once('idle', apply);
    return () => {
      map.off('idle', apply);
      remove();
    };
  }, [map, mapLoaded, features]);

  return { zone, recorded: data?.recorded ?? false, forcedDayRing: data?.forcedDayRing ?? false };
}
