'use client';

import { useEffect, useRef, useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { readSignal, type QualitySource } from './qualitySignal';
import { sunAltitudeDeg } from './solarPosition';
import type { TileInput } from './engine/types';

export interface LoadedTilesResult {
  tiles: TileInput[];
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  skipped: number;
  /** Tiles carried over from a previous cycle because their camera went missing. */
  held: number;
  loading: boolean;
}

export interface LoadTilesOptions {
  qualitySource: QualitySource;
  gateThreshold: number;
  /** The moment to compute solar position for; defaults to render time. */
  at?: string | number;
  /**
   * How many consecutive cycles a camera may go missing — absent from the
   * pool, or failed to load — before its tile is dropped. 0 drops at once.
   */
  missGraceCycles?: number;
}

const EMPTY: LoadedTilesResult = {
  tiles: [],
  byId: new Map(),
  skipped: 0,
  held: 0,
  loading: false,
};

function momentOf(at?: string | number): Date {
  if (at === undefined) return new Date();
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Loads a preview image per webcam and resolves each to the TileInput the
 * engine needs: natural dimensions, the gate/score signal, and the sun's
 * altitude at that place and moment. Failed loads are skipped, never drawn
 * as black boxes, but they are counted. A camera that goes missing for up to
 * `missGraceCycles` cycles is held with its last frame rather than exiting
 * and re-entering (spec §8).
 */
export function useLoadedTiles(
  webcams: WindyWebcam[],
  { qualitySource, gateThreshold, at, missGraceCycles = 0 }: LoadTilesOptions
): LoadedTilesResult {
  const [result, setResult] = useState<LoadedTilesResult>(EMPTY);

  // The last settled batch and each camera's run of misses — the memory the
  // grace needs. Refs, not state: they are read and written inside the
  // effect and must not re-trigger it.
  const lastRef = useRef<Pick<LoadedTilesResult, 'tiles' | 'byId'>>({ tiles: [], byId: new Map() });
  const missesRef = useRef(new Map<number, number>());

  useEffect(() => {
    let cancelled = false;

    const withPreview = webcams.filter((w) => w.images?.current?.preview);
    const noPreviewCount = webcams.length - withPreview.length;

    if (withPreview.length === 0) {
      // Bail out instead of always writing a fresh object. PreviewPane hands
      // us a brand-new `[]` on every render while a scene is still resolving,
      // and an unconditional setState there is an infinite render loop:
      // effect -> new state object -> re-render -> new array -> effect.
      // Returning `prev` unchanged makes React skip the re-render.
      lastRef.current = { tiles: [], byId: new Map() };
      missesRef.current.clear();
      setResult((prev) =>
        prev.tiles.length === 0 && prev.skipped === noPreviewCount && !prev.loading
          ? prev
          : { tiles: [], byId: new Map(), skipped: noPreviewCount, held: 0, loading: false }
      );
      return () => {
        cancelled = true;
      };
    }

    // Hold the last good batch while this one loads. Clearing here paints the
    // canvas black for as long as the images take, and the pool refetches
    // every 60s, so the wall blinked once a minute. The held tiles are at most
    // one cycle stale; the swap below is atomic.
    setResult((prev) => ({
      tiles: prev.tiles,
      byId: prev.byId,
      skipped: prev.skipped,
      held: prev.held,
      loading: true,
    }));

    const moment = momentOf(at);
    let settled = 0;
    let skipped = noPreviewCount;
    const tiles: TileInput[] = [];
    const byId = new Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>();

    const maybeFinish = () => {
      settled += 1;
      if (settled !== withPreview.length || cancelled) return;

      // Anything that loaded this cycle has no misses.
      for (const id of byId.keys()) missesRef.current.delete(id);

      // Carry over what went missing, for as long as the grace allows. The
      // held tile keeps its frame and its signal but gets a FRESH altitude,
      // so the exit taper keeps advancing while it is held.
      let held = 0;
      for (const [id, entry] of lastRef.current.byId) {
        if (byId.has(id)) continue;
        const misses = (missesRef.current.get(id) ?? 0) + 1;
        if (misses > missGraceCycles) {
          missesRef.current.delete(id);
          continue;
        }
        const prevTile = lastRef.current.tiles.find((t) => t.id === id);
        if (!prevTile) continue;
        missesRef.current.set(id, misses);
        tiles.push({
          ...prevTile,
          sunAltitudeDeg: sunAltitudeDeg(moment, prevTile.lat, prevTile.lng),
        });
        byId.set(id, entry);
        held += 1;
      }

      const next = { tiles: [...tiles], byId: new Map(byId), skipped, held, loading: false };
      lastRef.current = { tiles: next.tiles, byId: next.byId };
      setResult(next);
    };

    // CORS first so CORS-enabled hosts (the Windy CDN) leave the canvas
    // untainted; storage.googleapis.com serves NO CORS headers, so that
    // attempt fails there and the retry without crossOrigin is what actually
    // renders production frames. Tainting is fine — nothing reads pixels back.
    const loadFrame = (webcam: WindyWebcam, withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        const { passes, score } = readSignal(webcam, qualitySource, gateThreshold);
        const { latitude, longitude } = webcam.location;
        tiles.push({
          id: webcam.webcamId,
          lat: latitude,
          lng: longitude,
          srcWidth: img.naturalWidth,
          srcHeight: img.naturalHeight,
          passes,
          score,
          sunAltitudeDeg: sunAltitudeDeg(moment, latitude, longitude),
        });
        byId.set(webcam.webcamId, { img, webcam });
        maybeFinish();
      };
      img.onerror = () => {
        if (cancelled) return;
        if (withCors) {
          loadFrame(webcam, false);
          return;
        }
        skipped += 1;
        maybeFinish();
      };
      img.src = webcam.images!.current!.preview;
    };

    for (const webcam of withPreview) loadFrame(webcam, true);

    return () => {
      cancelled = true;
    };
  }, [webcams, qualitySource, gateThreshold, at, missGraceCycles]);

  return result;
}
