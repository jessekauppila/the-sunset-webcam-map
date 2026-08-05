'use client';

import { useEffect, useState } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { getQualityScore } from '@/app/lib/qualitySignal';
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

    if (withPreview.length === 0) {
      setResult(EMPTY);
      return () => {
        cancelled = true;
      };
    }

    let settled = 0;
    let skipped = 0;
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

    for (const webcam of withPreview) {
      const img = new Image();
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
        skipped += 1;
        maybeFinish();
      };
      img.src = webcam.images!.current!.preview;
    }

    return () => {
      cancelled = true;
    };
  }, [webcams]);

  return result;
}
