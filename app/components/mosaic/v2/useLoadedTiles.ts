'use client';

import { useEffect, useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { readSignal, type QualitySource } from './qualitySignal';
import { sunAltitudeDeg } from './solarPosition';
import type { TileInput } from './engine/types';

export interface LoadedTilesResult {
  tiles: TileInput[];
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  skipped: number;
  loading: boolean;
}

export interface LoadTilesOptions {
  qualitySource: QualitySource;
  gateThreshold: number;
  /** The moment to compute solar position for; defaults to render time. */
  at?: string | number;
}

const EMPTY: LoadedTilesResult = {
  tiles: [],
  byId: new Map(),
  skipped: 0,
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
 * as black boxes, but they are counted.
 */
export function useLoadedTiles(
  webcams: WindyWebcam[],
  { qualitySource, gateThreshold, at }: LoadTilesOptions
): LoadedTilesResult {
  const [result, setResult] = useState<LoadedTilesResult>(EMPTY);

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
      setResult((prev) =>
        prev.tiles.length === 0 && prev.skipped === noPreviewCount && !prev.loading
          ? prev
          : { tiles: [], byId: new Map(), skipped: noPreviewCount, loading: false }
      );
      return () => {
        cancelled = true;
      };
    }

    setResult({ tiles: [], byId: new Map(), skipped: noPreviewCount, loading: true });

    const moment = momentOf(at);
    let settled = 0;
    let skipped = noPreviewCount;
    const tiles: TileInput[] = [];
    const byId = new Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>();

    const maybeFinish = () => {
      settled += 1;
      if (settled === withPreview.length && !cancelled) {
        setResult({ tiles: [...tiles], byId: new Map(byId), skipped, loading: false });
      }
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
  }, [webcams, qualitySource, gateThreshold, at]);

  return result;
}
