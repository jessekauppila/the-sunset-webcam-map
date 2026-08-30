'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import { COMPOSITION_CONFIG } from './config';
import { compose } from './engine/compose';
import type { CompositionConfig } from './engine/types';
import { useLoadedTiles } from './useLoadedTiles';
import { SetupOverlay } from './SetupOverlay';

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  webcam: WindyWebcam;
}

export function GeoMosaic(props: {
  webcams: WindyWebcam[];
  width: number;
  height: number;
  feed: 'sunrise' | 'sunset';
  setupMode?: boolean;
  onSelect?: (webcam: WindyWebcam) => void;
  config?: Partial<CompositionConfig>;
}) {
  const {
    webcams,
    width,
    height,
    feed,
    setupMode = false,
    onSelect,
    config,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<HitRect[]>([]);

  const { tiles, byId, skipped, loading } = useLoadedTiles(webcams);

  const mergedConfig: CompositionConfig = useMemo(
    () => ({ ...COMPOSITION_CONFIG, ...config }),
    [config]
  );

  const layout = useMemo(
    () => compose(tiles, { width, height }, mergedConfig),
    [tiles, width, height, mergedConfig]
  );

  // Draw effect: dpr-scaled canvas, black backdrop, each placed tile's image.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.resetTransform?.();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const hitRects: HitRect[] = [];

    for (const tile of layout.tiles) {
      const entry = byId.get(tile.id);
      if (!entry) continue;
      ctx.drawImage(entry.img, tile.x, tile.y, tile.width, tile.height);
      hitRects.push({
        x: tile.x,
        y: tile.y,
        w: tile.width,
        h: tile.height,
        webcam: entry.webcam,
      });
    }

    hitRectsRef.current = hitRects;
  }, [layout, byId, width, height]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    for (const hit of hitRectsRef.current) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        onSelect(hit.webcam);
        return;
      }
    }
  };

  const feedLabel = feed === 'sunrise' ? 'SUNRISE' : 'SUNSET';
  const isEmpty = layout.tiles.length === 0 && !loading;

  return (
    <div style={{ position: 'relative', width, height }}>
      <canvas ref={canvasRef} onClick={handleClick} />
      {isEmpty && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            opacity: 0.3,
            color: '#fff',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          {feedLabel}
        </div>
      )}
      {setupMode && (
        <SetupOverlay layout={layout} feed={feed} skipped={skipped} />
      )}
    </div>
  );
}
