'use client';

import { useEffect, useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { getQualityScore } from './qualitySignal';
import type { TileInput } from './engine/types';

export interface LoadedTilesResult {
  tiles: TileInput[];
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  skipped: number;
  loading: boolean;
}

const EMPTY: LoadedTilesResult = {
  tiles: [],
  byId: new Map(),
  skipped: 0,
  loading: false,
};

/**
 * Loads a preview image for every webcam that has one, resolving to the
 * TileInput the composition engine needs (natural dimensions + quality
 * score). Failed loads are silently skipped (spec: no black boxes) but
 * counted. Re-runs whenever the webcam list identity changes.
 */
export function useLoadedTiles(webcams: WindyWebcam[]): LoadedTilesResult {
  const [result, setResult] = useState<LoadedTilesResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const withPreview = webcams.filter((w) => w.images?.current?.preview);
    const noPreviewCount = webcams.length - withPreview.length;

    if (withPreview.length === 0) {
      setResult({ ...EMPTY, skipped: noPreviewCount });
      return () => {
        cancelled = true;
      };
    }

    // Starting a new load cycle: announce it (loading: true) and reset the
    // accumulators so a stale previous cycle's tiles/byId/skipped don't leak
    // into this one. Webcams with no preview URL are counted as skipped
    // immediately so setup-mode's tiles+dropped+skipped tracks the full pool.
    setResult({ tiles: [], byId: new Map(), skipped: noPreviewCount, loading: true });

    let settled = 0;
    let skipped = noPreviewCount;
    const tiles: TileInput[] = [];
    const byId = new Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>();

    const maybeFinish = () => {
      settled += 1;
      if (settled === withPreview.length && !cancelled) {
        setResult({
          tiles: [...tiles],
          byId: new Map(byId),
          skipped,
          loading: false,
        });
      }
    };

    // Frames are loaded with crossOrigin='anonymous' first so CORS-enabled
    // hosts (Windy CDN) keep the canvas untainted; hosts that serve images
    // without CORS headers (storage.googleapis.com snapshot frames) fail that
    // load, so retry once without crossOrigin — the canvas taints, which is
    // fine because nothing reads pixels back (drawImage only).
    const loadFrame = (webcam: WindyWebcam, withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        tiles.push({
          id: webcam.webcamId,
          lat: webcam.location.latitude,
          lng: webcam.location.longitude,
          srcWidth: img.naturalWidth,
          srcHeight: img.naturalHeight,
          score: getQualityScore(webcam),
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

    for (const webcam of withPreview) {
      loadFrame(webcam, true);
    }

    return () => {
      cancelled = true;
    };
  }, [webcams]);

  return result;
}
